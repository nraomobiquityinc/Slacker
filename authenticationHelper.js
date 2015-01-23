/*
 * Authentication helper for bot.js.
 * Authenticates users that want to run actions requiring authorization.
 */
'use strict';

var config = require(__dirname + '/library/config');
var https = require('https');
var log = require(__dirname + '/library/log.js')
var parse = require(__dirname + '/library/parse.js')
var redis = require('redis');
var redisClient = redis.createClient();
var url = require('url')

exports.checkUserIsAuthenticated = function(data, response, doIfAuthenticated) {
  redisClient.sismember(config.REDIS_AUTH_USERS_SET, data.user_id, function(err, userIsAuthenticated) {
    if (err) {
      log.error(err);
      throw err;
    } else {
      if (userIsAuthenticated) {
        redisClient.hget(data.user_id, "accessToken", function(err, accessToken) {
          if (err) {
            log.error(err);
            throw err;
          } else {
            data.accessToken = accessToken;
            return doIfAuthenticated(data);
          }
        });
      } else {
        return authenticate(data, response);
      }
    }
  });
}

function authenticate(data, response) {
  var state = createStateNonce();

  var userState = {
    "state": state,
    "teamDomain": data.team_domain,
    "teamID": data.team_id,
  }

  redisClient.hmset(data.user_id, userState, function(err, response) {
    if (err) {
      sendMessage("Something wasn't right with redis. :disappointed:", data.channel_name);
      throw error;
    } else log.info("Added user " + data.user_id + " to redis");
  });

  response.statusCode = 200;
  response.end("You need to authorize slackbot to do that for you: <" + createAuthorizeURL(state + data.user_id) + ">" +
    "\nPlease try your command again once you've authorized us");
  return true;
};

exports.handleOauthCallback = function(request, response) {
  request.url = url.parse(request.url)
  request.url.parameters = request.url.query ? parse.httpParameters(request.url.query) : []
  if (request.url.parameters.error) {} else {
    var user_id = request.url.parameters.state.substring(config.STATE_NONCE_LENGTH);
    var state = request.url.parameters.state.substring(0, config.STATE_NONCE_LENGTH);

    checkStateIsValid(state, user_id, function(err, stateIsValid) {
      if (err) {
        response.statusCode = 400;
        return response.end(err.toString());
      } else {
        var options = {
          hostname: "slack.com",
          path: createOauthAccessPath(request.url.parameters.code),
          method: "GET"
        };

        var req = https.request(options, function(res) {
          var responseText = "";

          res.on("data", function(data) {
            responseText += data.toString();
          });

          res.on("end", function() {
            var responseJSON = JSON.parse(responseText);
            if (responseJSON.ok === true) {
              saveAccessToken(responseJSON.access_token, user_id);
              response.statusCode = 200;
              return response.end("Thank you for authorizing us. Please go back to Slacker and retry your command.");
            } else {
              response.statusCode = 400;
              return response.end("Something went wrong with authentication.");
            }
          });
        });

        req.on("error", function(error) {
          log.error("Something wasn't right. :disappointed:");
          throw error;
        });

        req.end();
      }
    });
  }
}

function checkStateIsValid(receivedState, user_id, callback) {
  redisClient.hget(user_id, "state", function(err, sentState) {
    if (err) {
      log.error(err);
      throw error;
    }

    if (receivedState === sentState)
      callback(null, true);
    else
      callback(new Error("State was invalid; expected: " + sentState + ", received: " + receivedState), null);
  });
}

function saveAccessToken(accessToken, user_id) {
  redisClient.hset(user_id, "accessToken", accessToken, function(err, response) {
    if (err) {
      log.info("Something wasn't right with redis. :disappointed:");
      throw error;
    }
    log.info("Updated user " + user_id + "'s access token to " + accessToken);
  });
  /*redisClient.hgetall(user_id, function(err, response){
        log.info(response);
    });*/
  recordThatUserIsAuthorized(user_id);
}

function recordThatUserIsAuthorized(user_id) {
  redisClient.sadd(config.REDIS_AUTH_USERS_SET, user_id, function(err, response) {
    if (err) {
      log.info("Something wasn't right with redis. :disappointed:");
      throw error;
    }
    log.info("User " + user_id + " is now authorized.");
  });
  /*redisClient.smembers(config.REDIS_AUTH_USERS_SET, function(err, response){
        log.info(response);
    });*/
}

function createOauthAccessPath(code) {
  return "/api/oauth.access?" + "client_id=" + config.authClientId + "&" +
    "client_secret=" + config.authClientSecret + "&" +
    "code=" + code;
}

function createStateNonce() {
  var ALLOWED_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";
  var state = "";
  for (var i = 0; i < config.STATE_NONCE_LENGTH; i++)
    state += ALLOWED_CHARS.charAt(Math.random() * ALLOWED_CHARS.length);
  return state;
}

function createAuthorizeURL(state) {
  return "https://slack.com/oauth/authorize?" + "client_id=" + config.authClientId + "&" + "state=" + state;
}
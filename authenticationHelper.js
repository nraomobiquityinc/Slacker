/*
 * Authentication helper for bot.js.
 * Authenticates users that want to run actions requiring authorization.
 */
'use strict';

var config = require(__dirname + '/library/config');
var log = require(__dirname + '/library/log.js')
var parse = require(__dirname + '/library/parse.js')
var redis = require('redis');
var redisClient = redis.createClient();
var url = require('url');
var request = require('superagent');

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
  redisClient.hget(data.user_id, "queuedActions", function(err, pastQueuedActionsList) {
    if (err) {
      sendMessage("Something wasn't right with redis. :disappointed:", data.channel_name);
      console.error("Unable to get queuedActions from redis for user " + data.user_id);
      throw err;
    } else {
      var actionData = {
        "timeStamp": new Date(Date.now()).toLocaleString(),
        "data": data
      }

      if (pastQueuedActionsList === null) {
        //user has never tried to issue an authenticated action before
        var state = createStateNonce();

        var userState = {
          "state": state,
          "teamDomain": data.team_domain,
          "teamID": data.team_id,
          "queuedActions": JSON.stringify([actionData])
        }

        redisClient.hmset(data.user_id, userState, function(err, res) {
          if (err) {
            sendMessage("Something wasn't right with redis. :disappointed:", data.channel_name);
            console.error("Unable to save state to redis for user " + data.user_id);
            throw err;
          } else {
            log.info("Added user " + data.user_id + " to redis");
            response.statusCode = 200;
            response.end("You need to authorize slackbot to do that for you: <" + createAuthorizeURL(state + data.user_id) + ">" +
              "\nYou only need to do this once. Your command will be run once you've authorized us");
            return true;
          }
        });
      } else {
        //user has tried to issue an authenticated action in the past but has never authorized us
        //enqueue this action and give him another chance to authorize us
        pastQueuedActionsList = JSON.parse(pastQueuedActionsList);
        pastQueuedActionsList.push(actionData);
        redisClient.hset(data.user_id, "queuedActions", JSON.stringify(pastQueuedActionsList), function(err, res) {
          if (err) {
            sendMessage("Something wasn't right with redis. :disappointed:", data.channel_name);
            console.error("Unable to update queuedActions in redis for user " + data.user_id);
            throw err;
          } else {
            log.info("Updated user " + data.user_id + "'s queuedActions in redis");
            redisClient.hget(data.user_id, "state", function(err, oldState) {
              if (err) {
                sendMessage("Something wasn't right with redis. :disappointed:", data.channel_name);
                console.error("Unable to retrieve old state from redis for user " + data.user_id);
                throw err;
              } else {
                response.statusCode = 200;
                response.end("You need to authorize slackbot to do that for you: <" + createAuthorizeURL(oldState + data.user_id) + ">" +
                  "\nYou only need to do this once. Your command will be run once you've authorized us");
                return true;
              }
            });
          }
        });
      }
    }
  })
};

exports.handleOauthCallback = function(request, response) {
  request.url = url.parse(request.url)
  request.url.parameters = request.url.query ? parse.httpParameters(request.url.query) : []
  if (request.url.parameters.error) {} else {
    var userId = request.url.parameters.state.substring(config.STATE_NONCE_LENGTH);
    var state = request.url.parameters.state.substring(0, config.STATE_NONCE_LENGTH);
    var code = request.url.parameters.code;
    checkStateIsValid(state, userId, code, response);
  }
}

function checkStateIsValid(receivedState, userId, code, response) {
  redisClient.hget(userId, "state", function(err, sentState) {
    if (err) {
      log.info("Something wasn't right with redis.");
      console.error("Unable to get state from redis for user " + userId);
      throw err;
    }

    if (receivedState === sentState) {
      request
        .get("https://slack.com/api/oauth.access?" + "client_id=" + config.authClientId +
          "&client_secret=" + config.authClientSecret + "&code=" + code)
        .end(function(err, res) {
          if (res.ok) {
            var responseJSON = res.body;
            if (responseJSON && responseJSON.ok === true) {
              return saveAccessToken(responseJSON.access_token, userId, response);
            } else {
              response.statusCode = 400;
              //TODO: add handlebar template for this error
              return response.end("Something went wrong with authentication.");
            }
          }
        });
    } else {
      response.statusCode = 400;
      //TODO: add handlebar template for this error
      return response.end("State was invalid; expected: " + sentState + ", received: " + receivedState);
    }
  });
}

function saveAccessToken(accessToken, userId, response) {
  redisClient.hset(userId, "accessToken", accessToken, function(err, res) {
    if (err) {
      log.info("Something wasn't right with redis.");
      console.error("Unable to save accessToken for userId " + userId + " to redis");
      throw err;
    }
    log.info("Updated user " + userId + "'s access token to " + accessToken);
    recordThatUserIsAuthorized(accessToken, userId, response);
  });
}

function recordThatUserIsAuthorized(accessToken, userId, response) {
  redisClient.sadd(config.REDIS_AUTH_USERS_SET, userId, function(err, res) {
    if (err) {
      log.info("Something wasn't right with redis.");
      console.error("Unable to add userId " + userId + " to authenticated users set in redis");
      throw err;
    }
    log.info("User " + userId + " is now authorized.");
    displayAuthSuccessPage(accessToken, userId, response);
  });
}

function displayAuthSuccessPage(accessToken, userId, response) {
  request
    .get("https://slack.com/api/users.info?token=" + accessToken + "&user=" + userId)
    .end(function(err, res) {
      if (err) {
        log.info("Unable to fetch user name from Slack for user with id " + userId);
        throw err;
      } else {
        if (res.ok) {
          var responseJSON = res.body;
          if (responseJSON && responseJSON.ok === true) {
            var userName = responseJSON.user.name;
            redisClient.hget(userId, "queuedActions", function(err, actions) {
              if (err) {
                log.info("Something wasn't right with redis.");
                console.error("Unable to get queuedActions for userId " + userId + " from redis");
                throw err;
              } else {
                response.render('authSuccess', {
                  userId: userId,
                  userName: userName,
                  actionsList: JSON.parse(actions)
                });
              }
            });
          }
        }
      }
    });
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
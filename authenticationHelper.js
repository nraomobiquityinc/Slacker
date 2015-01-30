/*
 * Authentication helper for bot.js.
 * Authenticates users that want to run actions requiring authorization.
 */
'use strict';

var _ = require('lodash');
var bot = require(__dirname + '/bot.js')
var config = require(__dirname + '/library/config');
var log = require(__dirname + '/library/log.js')
var parse = require(__dirname + '/library/parse.js')
var redis = require('redis');
var redisClient = redis.createClient();
var url = require('url');
var request = require('superagent');

exports.checkUserIsAuthenticated = function(data, response, doIfAuthenticated) {
  redisClient.hget(data.user_id, "accessToken", function(err, accessToken) {
    if (err) {
      log.error(err);
      throw err;
    } else {
      if (accessToken === null) { //user is not authenticated
        return authenticate(data, response);
      } else {
        data.accessToken = accessToken;
        return doIfAuthenticated(data);
      }
    }
  });
}

function authenticate(data, response) {
  redisClient.hget(data.user_id, "queuedActions", function(err, pastQueuedActionsList) {
    if (err) {
      log.info("Something wasn't right with redis.");
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
            log.info("Something wasn't right with redis.");
            console.error("Unable to save state to redis for user " + data.user_id);
            throw err;
          } else {
            log.info("Added user " + data.user_id + " to redis");
            saveState(state, response);
          }
        });
      } else {
        //user has tried to issue an authenticated action in the past but has never authorized us
        //enqueue this action and give him another chance to authorize us
        pastQueuedActionsList = JSON.parse(pastQueuedActionsList);
        pastQueuedActionsList.push(actionData);
        redisClient.hset(data.user_id, "queuedActions", JSON.stringify(pastQueuedActionsList), function(err, res) {
          if (err) {
            log.info("Something wasn't right with redis.");
            console.error("Unable to update queuedActions in redis for user " + data.user_id);
            throw err;
          } else {
            log.info("Updated user " + data.user_id + "'s queuedActions in redis");
            redisClient.hget(data.user_id, "state", function(err, oldState) {
              if (err) {
                log.info("Something wasn't right with redis.");
                console.error("Unable to retrieve old state from redis for user " + data.user_id);
                throw err;
              } else {
                return createAuthorizeResponse(oldState, response);
              }
            });
          }
        });
      }
    }
  })
};

function saveState(state, response) {
  redisClient.sadd(config.REDIS_VALID_AUTHS, state, function(err, stateAdded) {
    if (err) {
      log.info("Something wasn't right with redis.");
      console.error("Unable to save state " + state);
      throw err;
    } else {
      if (stateAdded) {
        log.info("Added state " + state + " to redis");
        return createAuthorizeResponse(state, response);
      }
    }
  });
}

function createAuthorizeResponse(state, response) {
  response.statusCode = 200;
  response.end("You need to authorize slackbot to do that for you: <" + createAuthorizeURL(state) + ">" +
    "\nYou only need to do this once. Your command will be run once you've authorized us");
  return true;
}

exports.handleOauthCallback = function(request, response) {
  request.url = url.parse(request.url)
  request.url.parameters = request.url.query ? parse.httpParameters(request.url.query) : []
  if (request.url.parameters.error) {
    response.render('error', {
      message: "Sorry, we cannot run commands without your authorization."
    });
  } else {
    var state = request.url.parameters.state;
    var code = request.url.parameters.code;
    checkStateIsValid(state, code, response);
  }
}

function checkStateIsValid(receivedState, code, response) {
  redisClient.sismember(config.REDIS_VALID_AUTHS, receivedState, function(err, stateFound) {
    if (err) {
      log.info("Something wasn't right with redis.");
      console.error("Unable to check set membership for state " + receivedState);
      throw err;
    }

    if (stateFound) {
      invalidateProcessedState(receivedState, code, response);
    } else {
      response.statusCode = 400;
      response.render('error', {
        message: "State " + receivedState + " was invalid"
      });
    }
  });
}

function invalidateProcessedState(processedState, code, response) {
  redisClient.srem(config.REDIS_VALID_AUTHS, processedState, function(err, stateDeleted) {
    if (err) {
      log.info("Something wasn't right with redis.");
      console.error("Unable to check set membership for state " + processedState);
      throw err;
    }

    if (stateDeleted) {
      getNewAccessToken(code, response);
    } else {
      log.error('Unable to delete state ' + processedState + ' from redis');
    }
  })
}

function getNewAccessToken(code, response) {
  request
    .get("https://slack.com/api/oauth.access?" + "client_id=" + config.authClientId +
      "&client_secret=" + config.authClientSecret + "&code=" + code)
    .end(function(err, res) {
      if (res.ok && res.body && (res.body.ok === true)) {
        return saveAccessToken(res.body.access_token, response);
      } else {
        response.statusCode = 400;
        return response.render('error', {
          message: "Something went wrong with authentication."
        });
      }
    });
}

//TODO: add a slack command to revoke user's auth token
//      this will clear any queued actions
//      and clear user's saved accessToken
function saveAccessToken(accessToken, response) {
  request
    .get("https://slack.com/api/auth.test?" + "token=" + accessToken)
    .end(function(err, res) {
      if (res.ok) {
        var userId = res.body.user_id;
        redisClient.hset(userId, "accessToken", accessToken, function(err, res) {
          if (err) {
            log.info("Something wasn't right with redis.");
            console.error("Unable to save accessToken for userId " + userId + " to redis");
            throw err;
          }
          log.info("Updated user " + userId + "'s access token to " + accessToken);
          displayAuthSuccessPage(accessToken, userId, response);
        });
      } else {
        log.info("Could not query oauth.test for token: " + accessToken);
      }
    });
}

function displayAuthSuccessPage(accessToken, userId, response) {
  request
    .get("https://slack.com/api/auth.test?token=" + accessToken)
    .end(function(err, res) {
      if (err) {
        log.info("Unable to fetch user name from Slack for user with id " + userId);
        throw err;
      } else {
        if (res.ok && res.body && (res.body.ok === true)) {
          var userName = res.body.user;
          redisClient.hget(userId, "queuedActions", function(err, actions) {
            if (err) {
              log.info("Something wasn't right with redis.");
              console.error("Unable to get queuedActions for userId " + userId + " from redis");
              throw err;
            } else {
              var actions = JSON.parse(actions);
              response.render('authSuccess', {
                userId: userId,
                userName: userName,
                actionsList: actions
              });
            }
          });
        }
      }
    });
}

/*
 * This function is only used right after authentication for the queued actions
 * that the user has chosen to run.
 */
exports.performAuthenticatedActions = function(userId, selectedActionIndices, response) {
  //fetch token and queuedActions
  var indices = selectedActionIndices;
  redisClient.hget(userId, "queuedActions", function(err, actionsData) {
    if (err) {
      log.info("Something wasn't right with redis.");
      console.error("Unable to get queuedActions for userId " + userId + " from redis");
      throw err;
    } else {
      if (actionsData === null) {
        response.statusCode = 400;
        return response.render('error', {
          message: "Your actions have already been processed."
        });
      }

      actionsData = JSON.parse(actionsData);
      redisClient.hdel(userId, "queuedActions", function(err, res) {
        if (err) {
          log.info("Something wasn't right with redis.");
          console.error("Unable to delete queuedActions for userId " + userId + " from redis");
          throw err;
        } else {
          _.forEach(indices, function(idx) {
            var action = actionsData[idx];
            var command = _.clone(action.data.command);
            var data = action.data;
            bot.processCommand(command, data, response, function(message) {
              bot.sendMessage(message + "\n*Action command*: `" + command.name + "`" +
                "\n*Action initially requested at*: " + action.timeStamp, userId,
                function(err, res) {
                  if (err) {
                    console.error("Unable to message userId " + userId + ", error: " + err);
                  } else {
                    if (res.body.ok) {
                      log.info("Sent userId " + userId + " message " + message);
                    } else {
                      log.error("Unable to mesage userId " + userId + ", error: " + JSON.stringify(res.body));
                    }
                  }
                });
            });
          });
        }
      });
    }
  });
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
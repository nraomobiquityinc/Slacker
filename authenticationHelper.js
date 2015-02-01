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
var url = require('url');
var request = require('superagent');
var dao = require(__dirname + '/dao/dao.js');
var models = require(__dirname + '/models/models.js');

exports.checkUserIsAuthenticated = function(data, response, doIfAuthenticated) {
  dao.getAccessTokenForUser(data.user_id, function(accessToken) {
    if (accessToken) {
      data.accessToken = accessToken;
      return doIfAuthenticated(data);
    } else { //user is not authenticated
      return authenticate(data, response);
    }
  });
}

function authenticate(data, response) {
  dao.getQueuedActionsForUser(data.user_id, function(pastQueuedActionsList) {
    var actionData = {
      userId: data.user_id,
      timeStamp: new Date(Date.now()).toLocaleString(),
      data: data
    }

    if (pastQueuedActionsList.length) {
      //user has tried to issue an authenticated action in the past but has never authorized us
      //enqueue this action and give him another chance to authorize us
      var action = new models.Action(actionData);
      dao.save(action, function(res) {
        log.info("Updated user " + data.user_id + "'s queuedActions in Mongo");
        dao.getStateForUser(data.user_id, function(oldState) {
          return createAuthorizeResponse(oldState, response);
        })
      });
    } else {
      //user has never tried to issue an authenticated action before
      var state = createStateNonce();

      var user = new models.User({
        _id: data.user_id,
        state: state,
        teamDomain: data.team_domain,
        teamID: data.team_id
      });

      var action = new models.Action(actionData);

      dao.saveUserAndAction(user, action, function(res) {
        createAuthorizeResponse(state, response);
      });
    }
  })
};

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
      message: "Sorry, we cannot run your commands unless you authorize us."
    });
  } else {
    var state = request.url.parameters.state;
    var code = request.url.parameters.code;
    checkStateIsValid(state, code, response);
  }
}

function checkStateIsValid(receivedState, code, response) {
  dao.getUserIdForState(receivedState, function(expectedUserId) {
    if (expectedUserId) {
      getNewAccessToken(code, expectedUserId, response);
    } else {
      response.statusCode = 400;
      response.render('error', {
        message: "Invalid request with state " + receivedState
      });
    }
  });
}

function getNewAccessToken(code, expectedUserId, response) {
  request
    .get("https://slack.com/api/oauth.access?" + "client_id=" + config.authClientId +
      "&client_secret=" + config.authClientSecret + "&code=" + code)
    .end(function(err, res) {
      if (res.ok && res.body && (res.body.ok === true)) {
        return saveAccessToken(res.body.access_token, expectedUserId, response);
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
function saveAccessToken(accessToken, expectedUserId, response) {
  request
    .get("https://slack.com/api/auth.test?" + "token=" + accessToken)
    .end(function(err, res) {
      if (res.ok) {
        var userId = res.body.user_id;
        var userName = res.body.user;
        if (userId === expectedUserId) {
          dao.saveAccessTokenForUser(accessToken, userId, function(res) {
            log.info("Updated user " + userId + "'s access token to " + accessToken);
            displayAuthSuccessPage(userId, userName, response);
          });
        } else {
          return response.render('error', {
            message: 'Invalid state credentials provided for user ' + userName
          });
        }
      }
    });
}

function displayAuthSuccessPage(userId, userName, response) {
  dao.getQueuedActionsForUser(userId, function(actions) {
    response.render('authSuccess', {
      userId: userId,
      userName: userName,
      actionsList: actions
    });
  });
}


/*
 * This function is only used right after authentication for the queued actions
 * that the user has chosen to run.
 */
exports.performAuthenticatedActions = function(userId, selectedActionIndices, response) {
  var indices = selectedActionIndices;
  dao.getQueuedActionsForUser(userId, function(actions) {
    if (actions.length) {
      dao.deleteActions(userId, function(res) {});
      _.forEach(indices, function(idx) {
        var action = actions[idx];
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
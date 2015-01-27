// Loads all of the bot functionality.
var bot = require(__dirname + '/../bot.js');
var _ = require('lodash');
var config = require(__dirname + '/../library/config');
var request = require('superagent');
var redis = require('redis');
var redisClient = redis.createClient();
var slackApi = require('slack-api');

var action = {
  name: 'rm',

  requiresAuth: true, //signal that this action requires the user to authenticate Slacker first

  description: 'Delete all the files you uploaded to Slack.',

  helpText: 'Delete all the files you uploaded to Slack. Caution: deleting files is permanent!',

  setup: function() {
    // This method will be run at server start up.
  },

  execute: function(data, callback) {
    deleteFiles(data.accessToken, callback);
  }
}

function deleteFiles(accessToken, callback) {
  request
    .get("https://slack.com/api/files.list?token=" + accessToken)
    .end(function(err, response) {
      if (response.ok) {
        var responseJSON = response.body;
        if (responseJSON.files && responseJSON.files.length > 0) {
          var recurse = _.after(responseJSON.files.length, function() {
            deleteFiles(accessToken, callback);
          });
          _.forEach(responseJSON.files, function(file) {
            deleteFile(accessToken, file, recurse);
          })
        } else {
          callback("No more files to delete.");
        }
      }
    });
}

function deleteFile(accessToken, file, recurse) {
  request
    .post("https://slack.com/api/files.delete?t=" + Math.floor((new Date()).getTime() / 1000))
    .type("form")
    .send({
      token: accessToken,
      file: file.id,
      set_active: "true",
      _attempts: "1"
    })
    .end(function(err, response) {
      if (response.body.ok === true) recurse();
    });
}

// Adds this action to the action list.
bot.addAction(action);
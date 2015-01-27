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
  slackApi.files.list({
    token: accessToken
  }, function(err, response) {
    if (response.ok) {
      if (response.files && response.files.length > 0) {
        var recurse = _.after(response.files.length, function() {
          deleteFiles(accessToken, callback);
        });
        _.forEach(response.files, function(file) {
          deleteFile(accessToken, file, recurse);
        })
      } else {
        callback("No more files to delete.");
      }
    }
  });
}

function deleteFile(accessToken, file, recurse) {
  slackApi.files.delete({
    t: Math.floor((new Date()).getTime() / 1000),
    token: accessToken,
    file: file.id
  }, function(err, response) {
    if (response.ok === true) recurse();
  });
}

// Adds this action to the action list.
bot.addAction(action);
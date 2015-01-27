// Loads all of the bot functionality.
var bot = require(__dirname + '/../bot.js');
var _ = require('lodash');
var config = require(__dirname + '/../library/config');
var request = require('superagent');
var redis = require('redis');
var redisClient = redis.createClient();
var slackApi = require('slack-api');

var Promise = require('bluebird');
var files = Promise.promisifyAll(require('slack-api').files);

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
  files.listAsync({
    token: accessToken
  }).then(function(response) {
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
  files.deleteAsync({
    t: Math.floor((new Date()).getTime() / 1000),
    token: accessToken,
    file: file.id
  }).then(function(response) {
    if (response.ok === true) recurse();
  });
}

// Adds this action to the action list.
bot.addAction(action);
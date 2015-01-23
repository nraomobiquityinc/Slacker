// Loads all of the bot functionality.
var bot = require(__dirname + '/../bot.js');
var _ = require('lodash');
var config = require(__dirname + '/../library/config');
var request = require('superagent');
var redis = require('redis');
var redisClient = redis.createClient();

var action = {
  name: 'rm',

  requiresAuth: true, //signal that this action requires the user to be authenticated

  description: 'Delete all the files you uploaded to Slack.',

  helpText: 'Delete all the files you uploaded to Slack.',

  setup: function() {
    // This method will be run at server start up.
  },

  execute: function(data, callback) {
    var accessToken = data.accessToken;
    listFiles(deleteFile);

    function listFiles(deleteFile) {
      request
        .get("https://slack.com/api/files.list?token=" + accessToken)
        .end(function(err, response) {
          if (response.ok) {
            var responseJSON = response.body;
            if (responseJSON && responseJSON.files.length > 0) {
              //console.log("found " + responseJSON.files.length);
              var recurse = _.after(responseJSON.files.length, function() {
                listFiles(deleteFile);
              });
              _.forEach(responseJSON.files, function(file) {
                deleteFile(file, recurse);
              })
            } else {
              callback("No more files to delete.");
            }
          }
        });
    }

    function deleteFile(file, recurse) {
      //console.log("attempting to delete " + file.id);
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
          //else console.log(response.body);
        });
    }
  }
};

// Adds this action to the action list.
bot.addAction(action);
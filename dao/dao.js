/*
 * Data Access Façade
 * Mongoのレコードを更新と追加と削除するオペレーションを簡単に利用するための
 * ファサード処理。
 */

var _ = require('lodash');
var log = require(__dirname + '/../library/log.js')
var models = require(__dirname + '/../models/models.js');

function mongoCallback(err, res, callback) {
  if (err) {
    console.error("Mongo error: " + err);
    log.error("Mongo error: " + err);
    throw err;
  } else callback(res);
}

var rightCurriedMongoCallback = _.curryRight(mongoCallback);

function getFieldForUser(fieldName, userId, callback) {
  models.User
    .findById(userId)
    .select(fieldName)
    .exec(rightCurriedMongoCallback(function(user) {
      if (user) callback(user[fieldName]);
      else callback(undefined);
    }));
}

var curriedGetFieldForUser = _.curry(getFieldForUser);
exports.getAccessTokenForUser = curriedGetFieldForUser('accessToken');
exports.getStateForUser = curriedGetFieldForUser('state');

function setFieldForUser(fieldName, fieldValue, userId, callback) {
  models.User
    .findById(userId, rightCurriedMongoCallback(function(user) {
      if (user) {
        user[fieldName] = fieldValue;
        exports.save(user, callback);
      } else {
        console.error("No user found with userId: " + userId);
        log.error("No user found with userId: " + userId);
      }
    }));
}
var curriedSetFieldForUser = _.curry(setFieldForUser);
exports.saveAccessTokenForUser = curriedSetFieldForUser('accessToken')

exports.getUserIdForState = function(state, callback) {
  models.User
    .findOne({
      state: state
    })
    .select('_id')
    .exec(rightCurriedMongoCallback(function(user) {
      callback(user['_id'])
    }));
}

exports.getQueuedActionsForUser = function(userId, callback) {
  models.Action
    .find({
      userId: userId
    })
    .sort({
      timestamp: -1
    })
    .exec(rightCurriedMongoCallback(callback));
}

exports.saveUserAndAction = function(user, action, callback) {
  exports.save(user, function(res) {
    log.info("Saved user: " + user._id + " to Mongo");
    exports.save(action, callback);
  });
}

exports.save = function(entity, callback) {
  entity.save(function(err) {
    mongoCallback(err, null, callback);
  });
}

exports.deleteActions = function(userId, callback) {
  models.Action
    .remove({
      userId: userId
    })
    .exec(function(err) {
      mongoCallback(err, null, callback);
    });
}
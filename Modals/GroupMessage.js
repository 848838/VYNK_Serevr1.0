const mongoose = require('mongoose');

const groupMessageSchema = new mongoose.Schema({
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group',
    required: true,
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  message: {
    type: String,
    default: '',
  },
  imageUri: {
    type: String,
    default: null,
  },
  replyTo: {
    messageId:  { type: mongoose.Schema.Types.ObjectId, default: null },
    message:    { type: String, default: '' },
    senderId:   { type: mongoose.Schema.Types.ObjectId, default: null },
    senderName: { type: String, default: '' },
    fileType:   { type: String, default: null },
  },
  reactions: {
    type: Map,
    of: String,
    default: {},
  },
  deletedFor: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  timestamp: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

module.exports = mongoose.model('GroupMessage', groupMessageSchema);
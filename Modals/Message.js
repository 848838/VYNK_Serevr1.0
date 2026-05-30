// Modals/Message.js
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  senderId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  message:    { type: String, default: '' },

  // ── Media ──────────────────────────────────────────
  imageUri:   { type: String, default: null },
  videoUri:   { type: String, default: null },
  fileUri:    { type: String, default: null },
  fileName:   { type: String, default: null },   // original filename for docs
  fileType:   { type: String, default: null },   // 'image' | 'video' | 'document'

  // ── Reply ──────────────────────────────────────────
  replyTo: {
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    message:   { type: String, default: null },
    senderId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    fileType:  { type: String, default: null },  // so reply preview knows what it was
  },
    sharedPost: {
    postId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
    caption:    String,
    imageUri:   String,
    authorName: String,
  },
deletedFor: [{ type: String }],
  // ── Emoji reactions ────────────────────────────────
  // { "userId": "emoji" }  — one reaction per user
  reactions: { type: Map, of: String, default: {} },

  seen:      { type: Boolean, default: false },
  timestamp: { type: Date,    default: Date.now },
});

module.exports = mongoose.model('Message', messageSchema);
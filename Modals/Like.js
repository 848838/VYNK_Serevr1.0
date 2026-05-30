const mongoose = require('mongoose');

const LikeSchema = new mongoose.Schema({
  fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  toUserId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action:     { type: String, enum: ['like', 'pass'], required: true },
  // Add to your Like schema:
status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' }
}, { timestamps: true });

LikeSchema.index({ fromUserId: 1, toUserId: 1 }, { unique: true });

module.exports = mongoose.model('Like', LikeSchema);
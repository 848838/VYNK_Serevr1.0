const mongoose = require('mongoose');

const chatRequestSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  otherUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined'], // ← ADD pending
    default: 'pending',
  },

}, {
  timestamps: true,
});

module.exports = mongoose.model('ChatRequest', chatRequestSchema);
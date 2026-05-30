// Modals/Post.js
const mongoose = require('mongoose');

const PostSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    caption: {
      type: String,
      default: '',
      trim: true,
    },
    imageUri: {
      type: String,
      default: null,
    },
    likes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],

  shares:   { type: Number, default: 0 },
  sharedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    comments: [
      {
        userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        text:      { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }   // adds createdAt + updatedAt automatically
);

module.exports = mongoose.model('Post', PostSchema);
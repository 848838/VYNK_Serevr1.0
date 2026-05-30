const mongoose = require('mongoose');

const MatchSchema = new mongoose.Schema({
  users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // always 2 users
}, { timestamps: true });

module.exports = mongoose.model('Match', MatchSchema);
const mongoose = require('mongoose');

const SessionSchema = new mongoose.Schema({
  sessionId:   { type: String, required: true },
  deviceName:  { type: String, default: 'Unknown Device' },
  platform:    { type: String, default: 'unknown' },   // 'ios' | 'android' | 'web'
  appVersion:  { type: String, default: '' },
  lastActive:  { type: Date, default: Date.now },
  createdAt:   { type: Date, default: Date.now },
}, { _id: false });

const UserSchema = new mongoose.Schema({
  name:           { type: String, default: '' },
  email:          { type: String, default: '' },
  password:       { type: String, default: '' },
  phone:          { type: String, default: '' },
  profileImage:   { type: String, default: '' },
  profession:     { type: String, default: '' },
  hobby:          { type: String, default: '' },
  stories:        [{ type: String }],
  lastOnline:     { type: Date, default: null },
  expoPushToken:  { type: String, default: '' },
  blockedUsers:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
bannerImage: { type: String, default: '' },
resetToken: String,
resetTokenExpiry: Number,
  // ── Active login sessions ────────────────────────────────────────────────
  // Each entry = one logged-in device. Remove an entry to force-logout that device.
  sessions: { type: [SessionSchema], default: [] },
});

module.exports = mongoose.model('User', UserSchema);
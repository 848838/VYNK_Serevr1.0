
require('dotenv').config();


const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const sendEmail = async ({ to, subject, html }) => {
  await resend.emails.send({
    from: 'Vynq <onboarding@resend.dev>',
    to,
    subject,
    html,
  });
};
const mongoose = require('mongoose');
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const ChatRequest = require('./Modals/ChatRequest')
const User = require('./Modals/User');
const { Server } = require('socket.io');
const http = require('http');
const Message = require('./Modals/Message');
const Like  = require('./Modals/Like');
const Match = require('./Modals/Match');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Group        = require('./Modals/Group');
const GroupMessage = require('./Modals/GroupMessage');
const app = express();
const port = 5001;

const JWT_SECRET = process.env.JWT_SECRET;

const server = http.createServer(app);
const uploadDir = path.join(__dirname, 'uploads');

const io = new Server(server, { cors: { origin: '*' } });
const sessionSocketMap = {};

const { Expo } = require('expo-server-sdk');
const expo = new Expo();

// ── Push notification helper ──────────────────────────────────────────────────
// FIX 1: Added senderId param so the tap navigates to the correct chat
// FIX 2: data payload now uses the real senderId (not receiverId)
async function sendPushNotification(receiverId, senderName, messageText, senderId) {
  try {
    const receiver = await User.findById(receiverId).select('expoPushToken');
    const sender = await User.findById(senderId).select('profileImage');

    if (!receiver?.expoPushToken) return;
    if (!Expo.isExpoPushToken(receiver.expoPushToken)) return;

const tickets = await expo.sendPushNotificationsAsync([
      {
        to: receiver.expoPushToken,
        sound: 'default',
        title: senderName,
        body: messageText || '📷 Image',
        data: { 
          senderId, 
          senderName,
          senderImage: sender?.profileImage || '',
        },
        priority: 'high',
      },
    ]);
    console.log('PUSH TICKETS:', JSON.stringify(tickets));
    console.log('SENDER PROFILE IMAGE:', sender?.profileImage); // ← add this to debug
  } catch (err) {
    console.error('Push notification error:', err.message);
  }
}

// ── Twilio ────────────────────────────────────────────────────────────────────
const twilio = require('twilio');

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const TWILIO_VERIFY_SID = process.env.TWILIO_VERIFY_SID;

app.use(express.json());
app.use(cors());
app.set('trust proxy', true);
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017')
  .then(() => console.log("Connected to backend server..."))
  .catch((err) => console.error("MongoDB error:", err));

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniqueSuffix}_${file.originalname}`);
  }
});

// Replace your multer fileFilter with this:
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/jpeg','image/png','image/gif','image/webp',
      'video/mp4','video/quicktime','video/webm',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    cb(null, allowed.includes(file.mimetype));
  },
  limits: { fileSize: 25 * 1024 * 1024 },   // 25 MB
});

app.use('/uploads', express.static('uploads'));
app.set('io', io);

// ── OTP: Send ─────────────────────────────────────────────────────────────────
app.post('/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number required' });

    await twilioClient.verify.v2
      .services(TWILIO_VERIFY_SID)
      .verifications.create({ to: phone, channel: 'sms' });

    res.json({ status: 'ok', message: 'OTP sent' });
  } catch (err) {
    console.error('send-otp error:', err.message);
    res.status(500).json({ error: 'Failed to send OTP', detail: err.message });
  }
});

// ── OTP: Verify + Login / Auto-Register ───────────────────────────────────────
app.post('/verify-otp', async (req, res) => {
  try {
    const { phone, code, deviceName, platform, appVersion } = req.body;
    if (!phone || !code) return res.status(400).json({ error: 'Phone and code required' });
 
    const result = await twilioClient.verify.v2
      .services(TWILIO_VERIFY_SID)
      .verificationChecks.create({ to: phone, code });
 
    if (result.status !== 'approved') {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }
 
    let user = await User.findOne({ phone });
    const isNewUser = !user;
    if (!user) {
      user = await User.create({ phone, name: '', profileImage: '' });
    }
 
// REPLACE WITH:
    const session = makeSession(deviceName, platform, appVersion);
    user.sessions.push(session);
    if (user.sessions.length > 5) user.sessions = user.sessions.slice(-5);
    await user.save();

    // Notify existing logged-in devices about new login
    const userId = user._id.toString();
    setTimeout(() => {
      io.to(userId).emit('newDeviceLoggedIn', {
        deviceName: session.deviceName,
        platform:   session.platform,
        time:       session.createdAt,
        newSessionId: session.sessionId,
      });
    }, 1000);

    const token = jwt.sign(
      { id: user._id, email: user.email, name: user.name,
        profileImage: user.profileImage, sessionId: session.sessionId },
      JWT_SECRET
    );

res.status(200).json({
  status: 'ok', isNewUser, token,
  sessionId: session.sessionId,        // ← ADD THIS LINE
  user: { id: user._id, phone: user.phone, name: user.name,
          email: user.email, profileImage: user.profileImage,
          profession: user.profession, hobby: user.hobby },
});
  } catch (err) {
    console.error('FULL ERROR:', JSON.stringify(err, null, 2));
    res.status(500).json({ error: 'Verification failed', detail: err.message, code: err.code });
  }
});

// ── mark-seen ─────────────────────────────────────────────────────────────────
app.post('/mark-seen', async (req, res) => {
  try {
    const { senderId, receiverId } = req.body;

    if (!senderId || !receiverId) {
      return res.status(400).json({ status: 'error', message: 'senderId and receiverId required' });
    }

    const result = await Message.updateMany(
      { senderId, receiverId, seen: false },
      { $set: { seen: true } }
    );

    if (result.modifiedCount > 0) {
      io.to(senderId).emit('messageSeen', {
        senderId,
        receiverId,
      });
      console.log(`messageSeen emitted to sender room: ${senderId} (${result.modifiedCount} messages marked)`);
    }

    res.json({ status: 'ok', modifiedCount: result.modifiedCount });
  } catch (err) {
    console.error('mark-seen error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ── Socket ────────────────────────────────────────────────────────────────────
const onlineUsers = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

socket.on('join', (userId) => {
  socket.join(userId);
  console.log('User joined room:', userId);
});

// REPLACE WITH:
socket.on('registerSession', ({ userId, sessionId }) => {
  socket.join(userId);
  socket.sessionId = sessionId;
  socket.userId = userId;
  sessionSocketMap[sessionId] = socket.id;
  console.log(`Registered session ${sessionId} → socket ${socket.id}`);
  console.log(`Socket ${socket.id} joined room: ${userId}`);
  // Log all sockets currently in this room
  const room = io.sockets.adapter.rooms.get(userId);
  console.log(`Room ${userId} now has ${room ? room.size : 0} socket(s)`);
});

  // ── Typing Events ─────────────────────────────────────────
  socket.on('typing', ({ senderId, receiverId }) => {
    io.to(receiverId).emit('typing', { senderId });
  });

  socket.on('stopTyping', ({ senderId, receiverId }) => {
    io.to(receiverId).emit('stopTyping', { senderId });
  });

  // ── Group Typing Events ───────────────────────────────────
  socket.on('groupTyping', ({ senderId, senderName, groupId }) => {
    socket.to(`group_${groupId}`).emit('groupTyping', { senderId, senderName });
  });

  socket.on('groupStopTyping', ({ senderId, groupId }) => {
    socket.to(`group_${groupId}`).emit('groupStopTyping', { senderId });
  });

  // ── WebRTC Signaling ──────────────────────────────────────
  socket.on('callUser', ({ to, from, fromName, fromImage, offer }) => {
    io.to(to).emit('incomingCall', { from, fromName, fromImage, offer });
  });

  socket.on('answerCall', ({ to, answer }) => {
    io.to(to).emit('callAnswered', { answer });
  });

  socket.on('iceCandidate', ({ to, candidate }) => {
    io.to(to).emit('iceCandidate', { candidate });
  });

  socket.on('endCall', ({ to }) => {
    io.to(to).emit('callEnded');
  });

  socket.on('rejectCall', ({ to }) => {
    io.to(to).emit('callRejected');
  });

  // ── User Online ───────────────────────────────────────────
  socket.on('userOnline', async (userId) => {
    if (!userId) return;
    socket.userId = userId;
    onlineUsers[userId] = socket.id;
    socket.join(userId);
    await User.findByIdAndUpdate(userId, { lastOnline: null });
    console.log('User online:', userId);
  });

  // ── Join all group rooms on connect ───────────────────────
  // Call this right after userOnline from the client
  socket.on('joinUserGroups', async (userId) => {
    try {
      const groups = await Group.find({ members: userId }, '_id');
      groups.forEach((g) => {
        socket.join(`group_${g._id}`);
      });
      console.log(`User ${userId} joined ${groups.length} group room(s)`);
    } catch (err) {
      console.error('joinUserGroups error:', err);
    }
  });

  // ── Join a single group room (open GroupChat screen) ──────
  socket.on('joinGroup', (groupId) => {
    socket.join(`group_${groupId}`);
    console.log(`Socket ${socket.id} joined group_${groupId}`);
  });

  socket.on('leaveGroup', (groupId) => {
    socket.leave(`group_${groupId}`);
  });

  // ── Send group text message ───────────────────────────────
  socket.on('sendGroupMessage', async ({ groupId, senderId, message, replyTo }) => {
    try {
      const group = await Group.findById(groupId).select('members name');
      if (!group) return;

      const isMember = group.members.map(String).includes(String(senderId));
      if (!isMember) return;

      const msg = await GroupMessage.create({
        groupId,
        senderId,
        message:  message || '',
        replyTo:  replyTo  || undefined,
        timestamp: new Date(),
      });

      const populated = await GroupMessage.findById(msg._id).populate(
        'senderId', 'name profileImage'
      );

      // Broadcast to every member in the group room
      io.to(`group_${groupId}`).emit('groupMessage', populated);

      // Push notification to all OTHER members
      const otherMembers = group.members.filter(
        (m) => String(m) !== String(senderId)
      );
      const senderUser = await User.findById(senderId).select('name');
      await Promise.all(
        otherMembers.map((memberId) =>
          sendPushNotification(
            memberId,
            `${senderUser?.name || 'Someone'} in ${group.name}`,
            message,
            senderId
          )
        )
      );
    } catch (err) {
      console.error('sendGroupMessage error:', err);
    }
  });

  // ── React to a group message ──────────────────────────────
  socket.on('groupReaction', async ({ messageId, userId, emoji }) => {
    try {
      const msg = await GroupMessage.findById(messageId);
      if (!msg) return;

      // emoji = null means remove reaction
      if (emoji) msg.reactions.set(String(userId), emoji);
      else        msg.reactions.delete(String(userId));

      await msg.save();

      io.to(`group_${msg.groupId}`).emit('groupReactionUpdate', {
        messageId,
        reactions: Object.fromEntries(msg.reactions),
      });
    } catch (err) {
      console.error('groupReaction error:', err);
    }
  });

  // ── Delete group message for self ─────────────────────────
  socket.on('deleteGroupMessage', async ({ messageId, userId }) => {
    try {
      const msg = await GroupMessage.findById(messageId);
      if (!msg) return;

      if (!msg.deletedFor.map(String).includes(String(userId))) {
        msg.deletedFor.push(userId);
        await msg.save();
      }

      // Only tell the requesting socket — deletion is per-user
      socket.emit('groupMessageDeleted', { messageId });
    } catch (err) {
      console.error('deleteGroupMessage error:', err);
    }
  });

  // ── 1-to-1 message (your existing handler, unchanged) ─────
  socket.on('sendMessage', async (data) => {
    const { senderId, receiverId, message, imageUri } = data;
    try {
      const receiver  = await User.findById(receiverId).select('blockedUsers');
      const isBlocked = receiver?.blockedUsers?.map(String).includes(String(senderId));
      if (isBlocked) {
        socket.emit('messageSendError', { error: 'blocked' });
        return;
      }

      const newMessage = new Message({
        senderId, receiverId, message, imageUri, timestamp: new Date(),
      });
      await newMessage.save();

      const senderUser = await User.findById(senderId).select('name');
      await sendPushNotification(receiverId, senderUser?.name || 'Someone', message, senderId);

      io.to(receiverId).emit('newMessage', {
        _id: newMessage._id, senderId, receiverId,
        message, imageUri, createdAt: newMessage.timestamp,
      });
      io.to(senderId).emit('messageSentConfirmation', { status: 'ok' });
    } catch (err) {
      console.error('sendMessage socket error:', err);
    }
  });

  // ── Disconnect ────────────────────────────────────────────
// REPLACE WITH:
  socket.on('disconnect', async () => {
    try { if (socket.sessionId) delete sessionSocketMap[socket.sessionId]; } catch (_) {}
    try {
      if (socket.userId) {
        await User.findByIdAndUpdate(socket.userId, { lastOnline: new Date() });
        delete onlineUsers[socket.userId];
        console.log('User offline:', socket.userId);
      }
    } catch (_) {}
    console.log('Socket disconnected:', socket.id);
  });
});

function makeSession(deviceName, platform, appVersion) {
  return {
    sessionId:  crypto.randomUUID(),          // unique per login
    deviceName: deviceName || 'Unknown Device',
    platform:   platform   || 'unknown',
    appVersion: appVersion || '',
    lastActive: new Date(),
    createdAt:  new Date(),
  };
}
 
// ── Auth routes ───────────────────────────────────────────────────────────────
app.post('/login', async (req, res) => {
  try {
    const { email, password, deviceName, platform, appVersion } = req.body;
    const user = await User.findOne({ email });
    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'Email or password incorrect' });
    }
 

const session = makeSession(deviceName, platform, appVersion);
user.sessions.push(session);
if (user.sessions.length > 5) user.sessions = user.sessions.slice(-5);
await user.save();

// Notify all already-logged-in devices that a new device just signed in
// Use setTimeout so existing sockets have time to be in the room
setTimeout(() => {
  io.to(user._id.toString()).emit('newDeviceLoggedIn', {
    deviceName: session.deviceName,
    platform:   session.platform,
    time:       session.createdAt,
    newSessionId: session.sessionId,  // so the new device can ignore its own alert
  });
}, 1000);
 
    const token = jwt.sign(
      { id: user._id, email: user.email, name: user.name,
        profileImage: user.profileImage, sessionId: session.sessionId },
      JWT_SECRET
    );
res.status(200).json({
  token,
  sessionId: session.sessionId,  // ✅ ADD THIS ONE LINE
  user: { id: user._id, email: user.email, name: user.name,
          profileImage: user.profileImage },
});
  } catch (error) {
    return res.status(500).json({ error: 'Login failed' });
  }
});
 


// ── Decline a request ─────────────────────────────────────────────────────────
app.post('/decline-request', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(400).json({ message: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const myId = decoded.id;
    const { blockedUserId } = req.body;

    await ChatRequest.findOneAndUpdate(
      { userId: myId, otherUserId: blockedUserId },
      { userId: myId, otherUserId: blockedUserId, status: 'declined' },
      { upsert: true }
    );
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
app.post('/ai-suggest', async (req, res) => {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(req.body),
  });
  const data = await response.json();
  res.json(data);
});
app.post('/accept-request', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(400).json({ message: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const myId = decoded.id;
    const { otherUserId } = req.body;

    await ChatRequest.findOneAndUpdate(
      { userId: myId, otherUserId },
      { userId: myId, otherUserId, status: 'accepted' },
      { upsert: true }
    );

    // ── Create a Match so both users appear in each other's recent-chats ──
    const existing = await Match.findOne({ users: { $all: [myId, otherUserId] } });
    if (!existing) {
      await Match.create({ users: [myId, otherUserId] });
    }

    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Get declined IDs ──────────────────────────────────────────────────────────
app.get('/declined-requests', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(400).json({ message: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const myId = decoded.id;

    const declined = await ChatRequest.find({ userId: myId, status: 'declined' }).select('otherUserId');
    const ids = declined.map(b => b.otherUserId.toString());
    res.json({ status: 'ok', declinedIds: ids });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.post('/signup', async (req, res) => {
  try {
    const { name, email, password, profileImage } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(409).json({ error: 'User already exists' });

    const newUser = new User({ name, email, password, profileImage });
    await newUser.save();

    const token = jwt.sign(
      { id: newUser._id, email: newUser.email, name: newUser.name, profileImage: newUser.profileImage },
      JWT_SECRET
    );
    res.status(201).json({
      token,
      user: { id: newUser._id, email: newUser.email, name: newUser.name, profileImage: newUser.profileImage }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Signup failed" });
  }
});
app.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'No account with this email' });

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = Date.now() + 3600000;

    user.resetToken = token;
    user.resetTokenExpiry = expiry;
    await user.save();

const resetLink = `vynk://reset-password?token=${token}`;

  await sendEmail({
  to: email,
  subject: 'Reset your Vynq password',
  html: `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <h2 style="color: #7c3aed;">Reset your Vynq password</h2>
      <p style="color: #374151; font-size: 15px;">
        Tap the button below to reset your password. This link expires in <strong>1 hour</strong>.
      </p>
      <a href="${resetLink}"
         style="display: inline-block; margin-top: 16px; padding: 14px 28px;
                background-color: #7c3aed; color: #ffffff; text-decoration: none;
                border-radius: 10px; font-weight: bold; font-size: 16px;">
        Reset Password
      </a>
      <p style="margin-top: 24px; color: #9ca3af; font-size: 13px;">
        If the button doesn't work, copy and paste this link:<br/>
        <span style="color: #7c3aed;">${resetLink}</span>
      </p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 16px;">
        If you didn't request this, ignore this email.
      </p>
    </div>
  `,
});
    res.json({ message: 'Reset email sent' });
  } catch (error) {
    console.error('forgot-password error:', error.message);
    res.status(500).json({ error: 'Failed to send reset email' });
  }
});
app.get('/reset-password/verify', async (req, res) => {
  const { token } = req.query;
  const user = await User.findOne({
    resetToken: token,
    resetTokenExpiry: { $gt: Date.now() },
  });
  if (!user) return res.status(400).json({ error: 'Invalid or expired token' });
  res.json({ valid: true });
});
app.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  const user = await User.findOne({
    resetToken: token,
    resetTokenExpiry: { $gt: Date.now() },
  });
  if (!user) return res.status(400).json({ error: 'Invalid or expired token' });

  user.password = newPassword; // hash it if you hash passwords
  user.resetToken = undefined;
  user.resetTokenExpiry = undefined;
  await user.save();

  res.json({ message: 'Password reset successful' });
});
app.post('/save-push-token', async (req, res) => {
  try {
    const { userId, pushToken } = req.body;
    if (!userId || !pushToken) return res.status(400).json({ status: 'error', message: 'Missing data' });
    await User.findByIdAndUpdate(userId, { expoPushToken: pushToken });
    console.log('Push token saved:', pushToken);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error' });
  }
});

app.post('/userdata', async (req, res) => {
  const { token } = req.body;
  try {
    const decodedUser = jwt.verify(token, JWT_SECRET);

    let user = await User.findById(decodedUser.id);

    if (!user && decodedUser.email) {
      user = await User.findOne({ email: decodedUser.email });
    }

    if (!user) return res.status(404).json({ message: "User not found" });
    res.send({ status: "ok", data: user });
  } catch (error) {
    console.error("Error verifying token in /userdata:", error.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
});
// ── Auth middleware (reuse your existing one if you have it) ──────────────────
const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ status: 'error', message: 'No token' });
 
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId    = decoded.id ?? decoded._id ?? decoded.userId;
    req.sessionId = decoded.sessionId;
 
    // If the JWT contains a sessionId, verify it's still active in the DB.
    // (Old JWTs without sessionId are still accepted for backwards-compat —
    //  remove this bypass once all clients have re-logged-in.)
    if (req.sessionId) {
      const user = await User.findById(req.userId).select('sessions');
      const alive = user?.sessions?.some(s => s.sessionId === req.sessionId);
      if (!alive) {
        return res.status(401).json({ status: 'error', message: 'Session revoked. Please log in again.' });
      }
      // Refresh lastActive (fire-and-forget — don't await)
      User.findOneAndUpdate(
        { _id: req.userId, 'sessions.sessionId': req.sessionId },
        { $set: { 'sessions.$.lastActive': new Date() } }
      ).catch(() => {});
    }
 
    next();
  } catch {
    res.status(401).json({ status: 'error', message: 'Invalid token' });
  }
};
app.get('/sessions', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('sessions');
    if (!user) return res.status(404).json({ status: 'error' });
 
    // Mark which session is the current one
    const sessions = (user.sessions || []).map(s => ({
      ...s.toObject(),
      isCurrent: s.sessionId === req.sessionId,
    })).sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive));
 
    res.json({ status: 'ok', sessions });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});


app.delete('/sessions/:sessionId', auth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    await User.findByIdAndUpdate(req.userId, {
      $pull: { sessions: { sessionId } },
    });
    // Only emit to that specific device's socket, not the whole room
    const targetSocketId = sessionSocketMap[sessionId];
    if (targetSocketId) {
      io.to(targetSocketId).emit('sessionRevoked', { sessionId });
    }
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

app.delete('/sessions', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('sessions');
    const otherSessions = (user.sessions || []).filter(
      s => s.sessionId !== req.sessionId
    );

    await User.findByIdAndUpdate(req.userId, {
      $set: { sessions: req.sessionId
        ? [{ sessionId: req.sessionId, deviceName: 'Current device',
             platform: 'unknown', lastActive: new Date(), createdAt: new Date() }]
        : [] },
    });

    // Only emit to each OTHER session's socket individually
    otherSessions.forEach(s => {
      const targetSocketId = sessionSocketMap[s.sessionId];
      if (targetSocketId) {
        io.to(targetSocketId).emit('sessionRevoked', { sessionId: s.sessionId });
      }
    });

    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});
// ── Multer for group avatar uploads ──────────────────────────────────────────
const groupStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),   // same folder you already use
  filename:    (req, file, cb) => cb(null, `grp_${Date.now()}${path.extname(file.originalname)}`),
});
const groupUpload = multer({ storage: groupStorage });

// ── Create group ─────────────────────────────────────────────────────────────
app.post('/create-group', auth, groupUpload.single('avatar'), async (req, res) => {
  try {
    const { name, memberIds } = req.body;
    const parsed = JSON.parse(memberIds);                  // array of user _id strings
    const members = [...new Set([req.userId, ...parsed])]; // always include creator

    const avatarUrl = req.file
      ? `${API_BASE_URL}/uploads/${req.file.filename}`     // adjust to your URL pattern
      : null;

    const group = await Group.create({
      name:    name.trim(),
      avatar:  avatarUrl,
      admin:   req.userId,
      members,
    });

    const populated = await group.populate('members', 'name profileImage');
    res.json({ status: 'ok', group: populated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ status: 'error', message: 'Failed to create group' });
  }
});
// ── Cancel a pending request ──────────────────────────────────────────────────
app.post('/cancel-request', auth, async (req, res) => {
  try {
    const { toUserId } = req.body;
    const result = await ChatRequest.findOneAndUpdate(
      { userId: req.userId, otherUserId: toUserId },
      { status: 'cancelled' },
      { new: true }
    );
    console.log('cancel-request result:', result);
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── Update my location ────────────────────────────────────────────────────────
app.post('/update-location', auth, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    await User.findByIdAndUpdate(req.userId, {
      location: {
        type: 'Point',
        coordinates: [longitude, latitude],
      },
    });
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── Get nearby users ──────────────────────────────────────────────────────────
app.get('/nearby-users', auth, async (req, res) => {
  try {
    const { latitude, longitude, radius = 10000 } = req.query; // radius in meters
    const me = await User.findById(req.userId).select('blockedUsers');
    const blockedIds = (me.blockedUsers || []).map(String);

    const users = await User.find({
      _id: { $ne: req.userId, $nin: blockedIds },
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [parseFloat(longitude), parseFloat(latitude)] },
          $maxDistance: parseFloat(radius),
        },
      },
    }).select('name profileImage profession hobby location').limit(50);

    // Calculate distance for each user
    const usersWithDistance = users.map(u => {
      const [uLng, uLat] = u.location.coordinates;
      const R = 6371;
      const dLat = (uLat - parseFloat(latitude)) * Math.PI / 180;
      const dLon = (uLng - parseFloat(longitude)) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(parseFloat(latitude) * Math.PI/180) * Math.cos(uLat * Math.PI/180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return {
_id: u._id,
        name: u.name,
        profileImage: u.profileImage,
        profession: u.profession,
        hobby: u.hobby,
        distance: Math.round(distance * 10) / 10,
        latitude: uLat,
        longitude: uLng,
      };
    });

    res.json({ status: 'ok', users: usersWithDistance });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});
// ── Get all groups for current user ──────────────────────────────────────────
app.get('/groups', auth, async (req, res) => {
  try {
    const groups = await Group.find({ members: req.userId })
      .populate('members', 'name profileImage')
      .sort({ updatedAt: -1 });

    // Attach last message to each group
    const withLastMsg = await Promise.all(groups.map(async (g) => {
      const last = await GroupMessage.findOne({ groupId: g._id, deletedFor: { $ne: req.userId } })
        .sort({ createdAt: -1 })
        .populate('senderId', 'name');
      return {
        ...g.toObject(),
        lastMessage:     last?.message || last?.imageUri ? '📷 Image' : null,
        lastMessageTime: last?.createdAt || g.updatedAt,
        lastSenderName:  last?.senderId?.name || '',
      };
    }));

    res.json({ status: 'ok', groups: withLastMsg });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch groups' });
  }
});

// ── Get single group info ─────────────────────────────────────────────────────
app.get('/group/:id', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id).populate('members', 'name profileImage');
    if (!group) return res.status(404).json({ status: 'error', message: 'Not found' });
    if (!group.members.some(m => String(m._id) === req.userId))
      return res.status(403).json({ status: 'error', message: 'Not a member' });
    res.json({ status: 'ok', group });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch group' });
  }
});

// ── Add member (admin only) ───────────────────────────────────────────────────
app.post('/group/:id/add-member', auth, async (req, res) => {
  try {
    const { userId } = req.body;
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ status: 'error' });
    if (String(group.admin) !== req.userId)
      return res.status(403).json({ status: 'error', message: 'Only admin can add members' });
    if (!group.members.includes(userId)) group.members.push(userId);
    await group.save();
    const updated = await group.populate('members', 'name profileImage');
    res.json({ status: 'ok', group: updated });
  } catch (e) {
    res.status(500).json({ status: 'error' });
  }
});

// ── Fetch group messages ──────────────────────────────────────────────────────
app.get('/group/:id/messages', auth, async (req, res) => {
  try {
    const messages = await GroupMessage.find({
      groupId:    req.params.id,
      deletedFor: { $ne: req.userId },
    })
      .populate('senderId', 'name profileImage')
      .sort({ createdAt: 1 });
    res.json({ status: 'ok', messages });
  } catch (e) {
    res.status(500).json({ status: 'error' });
  }
});

// ── Send group message via REST (fallback / image uploads) ────────────────────
const msgUpload = multer({ storage: groupStorage });
app.post('/group/:id/message', auth, msgUpload.single('image'), async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group || !group.members.includes(req.userId))
      return res.status(403).json({ status: 'error' });

    const imageUri = req.file ? `${API_BASE_URL}/uploads/${req.file.filename}` : null;
    const msg = await GroupMessage.create({
      groupId:  req.params.id,
      senderId: req.userId,
      message:  req.body.message || '',
      imageUri,
      replyTo:  req.body.replyTo ? JSON.parse(req.body.replyTo) : undefined,
    });
    const populated = await msg.populate('senderId', 'name profileImage');

    // Broadcast via socket to the group room
    io.to(`group_${req.params.id}`).emit('groupMessage', populated);
    res.json({ status: 'ok', message: populated });
  } catch (e) {
    res.status(500).json({ status: 'error' });
  }
});

// ── Leave group ───────────────────────────────────────────────────────────────
app.delete('/group/:id/leave', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ status: 'error' });
    group.members = group.members.filter(m => String(m) !== req.userId);
    // If admin left and members remain, promote first member
    if (String(group.admin) === req.userId && group.members.length > 0)
      group.admin = group.members[0];
    if (group.members.length === 0) await group.deleteOne();
    else await group.save();
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ status: 'error' });
  }
});
// ── Recent chats WITH unreadCount ─────────────────────────────────────────────
app.get('/recent-chats', auth, async (req, res) => {
  try {
    // Only show chats with matched users
    const matches = await Match.find({ users: req.userId });
    const matchedUserIds = matches.map(m =>
      String(m.users.find(u => String(u) !== req.userId))
    );

    const result = await Promise.all(matchedUserIds.map(async (otherId) => {
      const other = await User.findById(otherId).select('name profileImage profession hobby');
      const last  = await Message.findOne({
        $or: [
          { senderId: req.userId, receiverId: otherId },
          { senderId: otherId,    receiverId: req.userId },
        ],
      }).sort({ timestamp: -1 });

      const unread = await Message.countDocuments({
        senderId: otherId, receiverId: req.userId, seen: false,
      });

      return {
        _id: other._id, name: other.name,
        profileImage: other.profileImage,
        profession: other.profession,
        lastMessage: last?.message || null,
        lastMessageTime: last?.timestamp || null,
        unreadCount: unread,
        seen: unread === 0,
      };
    }));

    res.json({
  status: 'ok',
  users: result
    .filter(Boolean)
    .sort((a, b) => {
      const aTime = a.lastMessageTime ? new Date(a.lastMessageTime) : new Date(0);
      const bTime = b.lastMessageTime ? new Date(b.lastMessageTime) : new Date(0);
      return bTime - aTime;  // newest first
    }),
});
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── User routes ───────────────────────────────────────────────────────────────
app.get('/user/:id', async (req, res) => {
  try {
   const user = await User.findById(req.params.id).select('name profileImage bannerImage lastOnline profession hobby phone');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/users', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(400).json({ message: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const loggedInUserId = decoded.id;
    if (!loggedInUserId) return res.status(400).json({ message: 'User not authenticated' });

    const users = await User.find({ _id: { $ne: loggedInUserId } })
      .select('-password -verificationToken')
      .exec();

    if (!users || users.length === 0) return res.status(404).json({ message: 'No users found' });
    res.status(200).json({ users });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Error fetching users', error: error.message });
  }
});
// ── Delete a single story ─────────────────────────────────────────────────────
app.delete('/stories', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.id;
    const { storyUri } = req.body;

    if (!storyUri) return res.status(400).json({ message: 'storyUri required' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.stories = user.stories.filter(s => s !== storyUri);
    await user.save();

    // Try to delete the file from disk
    try {
      const filename = storyUri.split('/uploads/')[1];
      if (filename) {
        const filePath = path.join('uploads', filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    } catch (_) {}

    io.emit('storyDeleted', { userId, storyUri });
    res.json({ status: 'ok', stories: user.stories });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
// REPLACE the entire GET /messages route with this:
app.post('/messages', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ status: 'error', message: 'No token' });

    const decoded = jwt.verify(token, JWT_SECRET);
const { senderId, receiverId, message, imageUri, replyTo, fileName, fileType } = req.body;

    if (!senderId || !receiverId || !message) {
      return res.status(400).json({ status: 'error', message: 'Missing fields' });
    }

    // Check if receiver has blocked sender
    const receiver = await User.findById(receiverId).select('blockedUsers');
    const isBlocked = receiver?.blockedUsers?.map(String).includes(String(senderId));
    if (isBlocked) {
      return res.status(403).json({ status: 'blocked', message: 'You are blocked by this user.' });
    }

const newMessage = new Message({
  senderId, receiverId,
  message: message || '',
  imageUri: req.body.fileType === 'document' ? null : imageUri,
  fileUri:  req.body.fileType === 'document' ? imageUri : null,
  fileName: req.body.fileName || null,
  fileType: req.body.fileType || (imageUri ? 'image' : null),
  replyTo,
  timestamp: new Date(),
});
    await newMessage.save();

    const sender = await User.findById(senderId).select('name');
    await sendPushNotification(receiverId, sender?.name || 'Someone', message, senderId);

io.to(receiverId).emit('newMessage', {
      _id: newMessage._id,
      senderId,
      receiverId,
      message: newMessage.message,
      text: newMessage.message,
      senderName: sender.name,
      senderImage: sender.profileImage,
      createdAt: newMessage.timestamp,
      imageUri: newMessage.imageUri || null,
      fileUri:  newMessage.fileUri  || null,
      fileName: newMessage.fileName || null,
      fileType: newMessage.fileType || null,
      replyTo:  newMessage.replyTo  || null,
    });

    res.status(200).json({ status: 'ok', message: newMessage });
  } catch (err) {
    console.error('POST /messages error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});
// ── Check block status between me and another user ────────────────────────────
app.get('/check-blocked/:otherId', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const myId    = decoded.id;
    const { otherId } = req.params;

    const [me, otherUser] = await Promise.all([
      User.findById(myId).select('blockedUsers'),
      User.findById(otherId).select('blockedUsers'),
    ]);

    const iBlockedThem  = me?.blockedUsers?.map(String).includes(String(otherId))  ?? false;
    const blockedByThem = otherUser?.blockedUsers?.map(String).includes(String(myId)) ?? false;

    res.json({ status: 'ok', iBlockedThem, blockedByThem });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
app.get('/messages/images', async (req, res) => {
  try {
    const { userId } = req.query;
    const messages = await Message.find({
      $or: [{ senderId: userId }, { receiverId: userId }],
      imageUri: { $ne: null }
    }).sort({ timestamp: -1 });
    res.json({ status: 'ok', images: messages });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.get('/messages', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const { receiverId } = req.query;

  if (!token) return res.status(400).json({ message: 'No token provided' });
  if (!receiverId) return res.status(400).json({ message: 'Receiver ID is required' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const senderId = decoded.id;

const messages = await Message.find({
      $or: [
        { senderId, receiverId },
        { senderId: receiverId, receiverId: senderId },
      ],
      deletedFor: { $ne: senderId },
    }).sort({ timestamp: 1 });

    const messagesWithProfile = await Promise.all(
      messages.map(async (msg) => {
        const sender = await User.findById(msg.senderId).select('name profileImage');
        return {
          ...msg._doc,
          senderName: sender?.name || 'Unknown',
          profileImage: sender?.profileImage || 'default.jpg',
          imageUri: msg.imageUri,
        };
      })
    );

    if (!messagesWithProfile || messagesWithProfile.length === 0) {
      return res.status(404).json({ message: 'No messages found' });
    }

    res.status(200).json({ messages: messagesWithProfile });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ message: 'Error fetching messages', error: error.message });
  }
});

app.delete('/messages/:id', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(400).json({ message: 'No token provided' });

    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.id;

    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ status: 'error', message: 'Message not found' });

    if (message.senderId.toString() !== userId && message.receiverId.toString() !== userId) {
      return res.status(403).json({ status: 'error', message: 'You cannot delete this message' });
    }

    const { deleteFor } = req.query; // 'everyone' or 'me'

    if (deleteFor === 'everyone') {
      // only sender can delete for everyone
      if (message.senderId.toString() !== userId) {
        return res.status(403).json({ status: 'error', message: 'Only sender can delete for everyone' });
      }
      await message.deleteOne();
      // emit to both sender and receiver rooms
      io.to(message.senderId.toString()).emit('messageDeleted', req.params.id);
      io.to(message.receiverId.toString()).emit('messageDeleted', req.params.id);
    } else {
      // delete for me only — just mark it hidden for this user
      if (!message.deletedFor) message.deletedFor = [];
      if (!message.deletedFor.includes(userId)) {
        message.deletedFor.push(userId);
        await message.save();
      }
      io.to(userId).emit('messageDeleted', req.params.id);
    }

    res.status(200).json({ status: 'ok', message: 'Message deleted' });
  } catch (err) {
    console.error('Error deleting message:', err);
    res.status(500).json({ status: 'error', message: 'Failed to delete message' });
  }
});
// ── Block a user ──────────────────────────────────────────────────────────────
// ── Block a user ──────────────────────────────────────────────────────────────
app.post('/block-user', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const myId = decoded.id;
    const { blockUserId } = req.body;
    if (!blockUserId) return res.status(400).json({ message: 'blockUserId required' });

    await User.findByIdAndUpdate(myId, {
      $addToSet: { blockedUsers: blockUserId },
    });

    // ✅ Notify the person who got blocked — in real time
    io.to(blockUserId).emit('youWereBlocked', { by: myId });

    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Unblock a user ────────────────────────────────────────────────────────────
app.post('/unblock-user', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const myId = decoded.id;
    const { unblockUserId } = req.body;
    if (!unblockUserId) return res.status(400).json({ message: 'unblockUserId required' });

    await User.findByIdAndUpdate(myId, {
      $pull: { blockedUsers: unblockUserId },
    });

    // ✅ Notify the person who got unblocked — in real time
    io.to(unblockUserId).emit('youWereUnblocked', { by: myId });

    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Get my blocked users (with profile info) ──────────────────────────────────
app.get('/blocked-users', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const myId = decoded.id;

    const me = await User.findById(myId).populate('blockedUsers', 'name profileImage phone');
    res.json({ status: 'ok', blockedUsers: me.blockedUsers || [] });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
// ── Image / Story routes ──────────────────────────────────────────────────────
app.post('/sendMessageWithImage', upload.single('image'), async (req, res) => {
  const { senderId, receiverId, message } = req.body;
  if (!senderId || !receiverId || (!message && !req.file)) {
    return res.status(400).json({ message: 'Sender, receiver, and either a message or image are required' });
  }
  try {
    let imageUri = null;
    if (req.file) imageUri = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

    const sender = await User.findById(senderId).select('name profileImage');
    if (!sender) return res.status(404).json({ message: 'Sender not found' });
const receiverUser = await User.findById(receiverId).select('blockedUsers');
const isBlocked = receiverUser?.blockedUsers?.map(String).includes(String(senderId));
if (isBlocked) {
  return res.status(403).json({ status: 'blocked', message: 'You are blocked by this user.' });
}
  let replyTo = null;
if (req.body.replyTo) {
  try { replyTo = JSON.parse(req.body.replyTo); } catch(_) {}
}


const newMessage = new Message({
  senderId, receiverId,
  message: message || '',
  imageUri,
  replyTo,
  timestamp: new Date(),
});
    await newMessage.save();

    // ✅ Already correct here — passes senderId properly
    await sendPushNotification(
      receiverId,
      sender.name,
      message || '📷 Image',
      senderId
    );

io.to(receiverId).emit('newMessage', {
      _id: newMessage._id,
      senderId,
      receiverId,
      message: newMessage.message,
      text: newMessage.message,
      senderName: sender.name,
      senderImage: sender.profileImage,
      createdAt: newMessage.timestamp,
      imageUri: newMessage.imageUri || null,
      replyTo: newMessage.replyTo || null,
    });

    res.status(200).json({ status: 'ok', message: newMessage });
  } catch (error) {
    console.error('Error sending message with image:', error);
    res.status(500).json({ status: 'error', message: 'Failed to send message with image', error: error.message });
  }
});
// ── Add / change reaction ─────────────────────────────────────────────────────
app.post('/messages/:id/react', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.id;
    const { emoji } = req.body;          // e.g. "❤️"

    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ status: 'error' });

    if (emoji) {
      msg.reactions.set(userId, emoji);
    } else {
      msg.reactions.delete(userId);      // empty emoji = remove reaction
    }
    await msg.save();

    // Broadcast to both participants
    io.to(msg.senderId.toString()).emit('reactionUpdated', {
      messageId: msg._id,
      reactions: Object.fromEntries(msg.reactions),
    });
    io.to(msg.receiverId.toString()).emit('reactionUpdated', {
      messageId: msg._id,
      reactions: Object.fromEntries(msg.reactions),
    });

    res.json({ status: 'ok', reactions: Object.fromEntries(msg.reactions) });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});
// AFTER
app.post('/stories', upload.single('stories'), async (req, res) => {  // ← lowercase
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ message: 'User ID is required' });
  if (!req.file) return res.status(400).json({ message: 'Story image is required' });

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const storiesUri = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    if (!Array.isArray(user.stories)) user.stories = [];
    user.stories.push(storiesUri);
    await user.save();

    // ← emit 'newStory' so the client listener fires
    io.emit('newStory', {
      userId: user._id,
      profileImage: user.profileImage,
      name: user.name,
      stories: [storiesUri],   // just the new one; client merges it in
    });

    res.status(200).json({ status: 'ok', stories: user.stories });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});
// ── React to a story ──────────────────────────────────────────────────────────
app.post('/story-reaction', auth, async (req, res) => {
  try {
    const { toUserId, emoji, storyUri } = req.body;
    if (!toUserId || !emoji) return res.status(400).json({ status: 'error' });

    const sender = await User.findById(req.userId).select('name profileImage');

    // Send as a DM
    const newMessage = new Message({
      senderId:   req.userId,
      receiverId: toUserId,
      message:    emoji,
      timestamp:  new Date(),
    });
    await newMessage.save();

    // Real-time DM
    io.to(toUserId).emit('newMessage', {
      _id:         newMessage._id,
      senderId:    req.userId,
      receiverId:  toUserId,
      message:     emoji,
      createdAt:   newMessage.timestamp,
      senderName:  sender.name,
      senderImage: sender.profileImage,
    });

    // Real-time story reaction notification to poster
    io.to(toUserId).emit('storyReaction', {
      fromUserId:   req.userId,
      fromName:     sender.name,
      fromImage:    sender.profileImage,
      emoji,
      storyUri,
    });

    // Push notification
    await sendPushNotification(
      toUserId,
      sender.name,
      `Reacted ${emoji} to your story`,
      req.userId
    );

    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});
app.get('/stories', auth, async (req, res) => {
  try {
    // Get all connected user IDs (same logic as /feed)
    const accepted = await ChatRequest.find({
      $or: [
        { userId: req.userId, status: 'accepted' },
        { otherUserId: req.userId, status: 'accepted' },
      ],
    });
    const matches = await Match.find({ users: req.userId });

    const connectedIds = accepted.map(r =>
      String(r.userId) === String(req.userId)
        ? String(r.otherUserId)
        : String(r.userId)
    );
    const matchedIds = matches.map(m =>
      String(m.users.find(u => String(u) !== String(req.userId)))
    );

    // Include self so own story shows
    const allIds = [...new Set([...connectedIds, ...matchedIds, String(req.userId)])];

    const users = await User.find({
      _id: { $in: allIds },
      stories: { $exists: true, $not: { $size: 0 } },
    }).select('stories name profileImage');

    const allStories = users
      .map(user => ({
        userId: user._id,
        stories: user.stories,
        profileImage: user.profileImage,
        name: user.name,
      }))
      .filter(s => s.stories.length > 0);

    res.status(200).json({ status: 'ok', stories: allStories });
  } catch (error) {
    console.error('Error fetching stories:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch stories', error: error.message });
  }
});
app.post('/respond-like', auth, async (req, res) => {
  try {
    const toUserId   = req.userId;          // the person who received the like
    const { fromUserId, action } = req.body; // action: 'accept' | 'decline'

    await Like.findOneAndUpdate(
      { fromUserId, toUserId },
      { status: action === 'accept' ? 'accepted' : 'declined' }
    );

    if (action === 'decline') return res.json({ status: 'ok', match: false });

    // Create match if not already exists
    const existing = await Match.findOne({ users: { $all: [fromUserId, toUserId] } });
    const match = existing || await Match.create({ users: [fromUserId, toUserId] });

    const [userA, userB] = await Promise.all([
      User.findById(fromUserId).select('name profileImage'),
      User.findById(toUserId).select('name profileImage'),
    ]);

    // Tell the original liker their like was accepted
    io.to(fromUserId).emit('likeAccepted', {
      matchId: match._id,
      matchedUser: { _id: userB._id, name: userB.name, profileImage: userB.profileImage },
    });

    // Tell both it's a match
    io.to(fromUserId).emit('newMatch', {
      matchId: match._id,
      matchedUser: { _id: userB._id, name: userB.name, profileImage: userB.profileImage },
    });
    io.to(toUserId).emit('newMatch', {
      matchId: match._id,
      matchedUser: { _id: userA._id, name: userA.name, profileImage: userA.profileImage },
    });

    // Push notifications
    await sendPushNotification(fromUserId, "Like Accepted! 🎉", `${userB.name} accepted your like`, toUserId);

    res.json({ status: 'ok', match: true, matchId: match._id });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});


app.get('/pending-likes', auth, async (req, res) => {
  try {
    const pending = await Like.find({ toUserId: req.userId, status: 'pending' });
    const result = await Promise.all(pending.map(async (l) => {
      const user = await User.findById(l.fromUserId).select('name profileImage');
      return { fromUserId: l.fromUserId, name: user?.name, profileImage: user?.profileImage };
    }));
    res.json({ status: 'ok', likes: result });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});
app.put('/updateprofile', upload.fields([
  { name: 'profileImage', maxCount: 1 },
  { name: 'bannerImage',  maxCount: 1 },
]), async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(400).json({ message: 'No token provided' });
  try {
    const decodedToken = jwt.verify(token, JWT_SECRET);
    const userId = decodedToken.id;

    const updateData = {
      name: req.body.name,
      profession: req.body.profession,
      hobby: req.body.hobby,
    };

    if (req.files?.profileImage?.[0])
      updateData.profileImage = `${req.protocol}://${req.get('host')}/uploads/${req.files.profileImage[0].filename}`;
    if (req.files?.bannerImage?.[0])
      updateData.bannerImage = `${req.protocol}://${req.get('host')}/uploads/${req.files.bannerImage[0].filename}`;

    const updatedUser = await User.findByIdAndUpdate(userId, updateData, { new: true, runValidators: true });
    if (!updatedUser) return res.status(404).json({ message: 'User not found' });

    io.emit('profileUpdated', updatedUser);
    res.status(200).json({ status: 'ok', user: updatedUser });
  } catch (error) {
    res.status(500).json({ message: 'Error updating profile', error: error.message });
  }
});
app.post('/swipe', auth, async (req, res) => {
  try {
    const fromUserId = req.userId;
    const { toUserId, action } = req.body;

    await Like.findOneAndUpdate(
      { fromUserId, toUserId },
      { fromUserId, toUserId, action, status: action === 'like' ? 'pending' : 'declined' },
      { upsert: true }
    );

    if (action !== 'like') return res.json({ status: 'ok', match: false });

    // Notify the liked user in real time
    const liker = await User.findById(fromUserId).select('name profileImage');
    io.to(toUserId).emit('incomingLike', {
      fromUserId,
      name: liker.name,
      profileImage: liker.profileImage,
    });

    // Push notification to liked user
    await sendPushNotification(
      toUserId,
      `${liker.name} liked you! 💜`,
      'Tap to accept or decline',
      fromUserId
    );

    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── Get my matches (with last message) ───────────────────────────────────────
app.get('/matches', auth, async (req, res) => {
  try {
    const matches = await Match.find({ users: req.userId }).sort({ createdAt: -1 });

    const result = await Promise.all(matches.map(async (m) => {
      const otherId = m.users.find(u => String(u) !== req.userId);
      const other   = await User.findById(otherId).select('name profileImage lastOnline');
      const last    = await Message.findOne({
        $or: [
          { senderId: req.userId, receiverId: otherId },
          { senderId: otherId,    receiverId: req.userId },
        ],
      }).sort({ timestamp: -1 });

      const unread = await Message.countDocuments({
        senderId: otherId, receiverId: req.userId, seen: false,
      });

      return {
        matchId:         m._id,
        matchedAt:       m.createdAt,
        user:            other,
        lastMessage:     last?.message || null,
        lastMessageTime: last?.timestamp || m.createdAt,
        unreadCount:     unread,
      };
    }));

    res.json({ status: 'ok', matches: result });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── Get swipe deck (users not yet swiped) ────────────────────────────────────
app.get('/swipe-deck', auth, async (req, res) => {
  try {
    const alreadySwiped = await Like.find({ fromUserId: req.userId }).select('toUserId');
    const swipedIds = alreadySwiped.map(l => l.toUserId);
    swipedIds.push(req.userId); // exclude self

    const users = await User.find({ _id: { $nin: swipedIds } })
      .select('name profileImage profession hobby')
      .limit(20);

    res.json({ status: 'ok', users });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});


const Post = require('./Modals/Post'); // create this model

// ── Send follow/chat request ──────────────────────────────────────────────────
app.post('/send-request', auth, async (req, res) => {
  try {
    const { toUserId } = req.body;
    const existing = await ChatRequest.findOne({
      userId: req.userId, otherUserId: toUserId
    });
  if (existing) {
    if (existing.status === 'pending' || existing.status === 'accepted') {
      return res.json({ status: 'ok', requestStatus: existing.status });
    }
    existing.status = 'pending';
    await existing.save();

    const sender = await User.findById(req.userId).select('name profileImage');
    io.to(toUserId).emit('newFollowRequest', {
      fromUserId: req.userId,
      name: sender.name,
      profileImage: sender.profileImage,
    });

    return res.json({ status: 'ok', requestStatus: 'pending' });
  }

    await ChatRequest.create({
      userId: req.userId, otherUserId: toUserId, status: 'pending'
    });

    // Notify in real time
    const sender = await User.findById(req.userId).select('name profileImage');
    io.to(toUserId).emit('newFollowRequest', {
      fromUserId: req.userId,
      name: sender.name,
      profileImage: sender.profileImage,
    });

    res.json({ status: 'ok', requestStatus: 'pending' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── Get request status between me and another user ────────────────────────────
app.get('/request-status/:otherId', auth, async (req, res) => {
  try {
    const { otherId } = req.params;
    const sent = await ChatRequest.findOne({
      userId: req.userId, otherUserId: otherId
    });
    const received = await ChatRequest.findOne({
      userId: otherId, otherUserId: req.userId
    });
    res.json({
      status: 'ok',
      sentStatus: sent?.status || null,       // 'pending' | 'accepted' | 'declined' | null
      receivedStatus: received?.status || null,
    });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

app.get('/debug-feed', auth, async (req, res) => {
  try {
    const accepted = await ChatRequest.find({
      $or: [
        { userId: req.userId, status: 'accepted' },
        { otherUserId: req.userId, status: 'accepted' },
      ],
    });

    const matches = await Match.find({ users: req.userId });

    const allPosts = await Post.find()
      .populate('userId', 'name')
      .select('userId caption');

    res.json({
      myId: req.userId,
      acceptedRequests: accepted,
      matches: matches,
      totalPosts: allPosts,
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
// ── Feed: posts from accepted-request users ───────────────────────────────────
app.get('/feed', auth, async (req, res) => {
  try {
    // Get all accepted connections in BOTH directions
    const accepted = await ChatRequest.find({
      $or: [
        { userId: req.userId, status: 'accepted' },
        { otherUserId: req.userId, status: 'accepted' },
      ],
    });

    const connectedIds = accepted.map(r =>
      String(r.userId) === String(req.userId)
        ? String(r.otherUserId)
        : String(r.userId)
    );

    // Also include users matched via Match collection
    const matches = await Match.find({ users: req.userId });
    const matchedIds = matches.map(m =>
      String(m.users.find(u => String(u) !== String(req.userId)))
    );

const me = await User.findById(req.userId).select('blockedUsers');
const blockedIds = (me.blockedUsers || []).map(String);

const allConnectedIds = [...new Set([...connectedIds, ...matchedIds, String(req.userId)])]
  .filter(id => !blockedIds.includes(id));

    if (allConnectedIds.length === 0) {
      return res.json({ status: 'ok', posts: [] });
    }

const posts = await Post.find({ userId: { $in: allConnectedIds } })
  .populate('userId', 'name profileImage bannerImage')
  .populate('comments.userId', 'name profileImage')
  .sort({ createdAt: -1 })
  .limit(50);
    res.json({ status: 'ok', posts });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});
// ── POST /create-post ─────────────────────────────────────────────────────────
// Body: { token, caption, imageUri }
app.post('/create-post', async (req, res) => {
  try {
    const { token, caption, imageUri } = req.body;
    console.log('CREATE POST HIT', { caption, imageUri });
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('USER ID:', decoded.id);
    const post = await Post.create({
      userId:   decoded.id,
      caption,
      imageUri: imageUri || null,
    });
    console.log('POST SAVED:', post._id); // ← and this
    res.json({ status: 'ok', post });
  } catch (e) {
    console.error('CREATE POST ERROR:', e.message); // ← and this
    res.json({ status: 'error', message: e.message });
  }
});

// ── GET /get-posts ────────────────────────────────────────────────────────────
// Returns all posts newest first, with user info populated
app.get('/get-posts', async (req, res) => {
  try {
    const posts = await Post.find()
      .sort({ createdAt: -1 })
      .populate('userId', 'name profileImage')
      .populate('comments.userId', 'name profileImage');
    console.log('POSTS COUNT:', posts.length); // ← add this
    res.json({ status: 'ok', posts });
  } catch (e) {
    console.error('GET POSTS ERROR:', e.message);
    res.json({ status: 'error', message: e.message });
  }
});

// ── POST /add-comment ─────────────────────────────────────────────────────────
// Body: { token, postId, text }
app.post('/add-comment', async (req, res) => {
  try {
    const { token, postId, text } = req.body;
    const decoded = jwt.verify(token, JWT_SECRET);
    const post = await Post.findByIdAndUpdate(
      postId,
      { $push: { comments: { userId: decoded.id, text } } },
      { new: true }
    ).populate('comments.userId', 'name profileImage');
    res.json({ status: 'ok', post });
  } catch (e) {
    res.json({ status: 'error', message: e.message });
  }
});

app.post('/toggle-like', async (req, res) => {
  try {
    const { token, postId } = req.body;
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId  = String(decoded.id);
    const post    = await Post.findById(postId);

    const alreadyLiked = post.likes.map(String).includes(userId);

    if (alreadyLiked) {
      // Remove like
      post.likes = post.likes.filter(id => id != null && String(id) !== userId);
    } else {
      // Remove nulls + add like (no duplicates possible)
      post.likes = post.likes.filter(id => id != null && String(id) !== userId);
      post.likes.push(userId);
    }

    await post.save();
    res.json({ status: 'ok', likes: post.likes });
  } catch (e) {
    res.json({ status: 'error', message: e.message });
  }
});
// ── Add comment to a post ─────────────────────────────────────────────────────
app.post('/posts/:id/comment', auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ status: 'error', message: 'Comment text required' });

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ status: 'error' });

    post.comments.push({ userId: req.userId, text: text.trim() });
    await post.save();

    const updated = await Post.findById(req.params.id)
      .populate('comments.userId', 'name profileImage');

    // Notify post owner in real time
    const me = await User.findById(req.userId).select('name');
    io.to(String(post.userId)).emit('newComment', {
      postId: post._id,
      commenterName: me.name,
      text: text.trim(),
    });

    res.json({ status: 'ok', comments: updated.comments });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});
// ── Posts ─────────────────────────────────────────────────────────────────────
app.post('/posts', auth, upload.single('image'), async (req, res) => {
  try {
    const imageUri = req.file
      ? `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`
      : null;

    const caption = req.body.caption || '';

    const post = await Post.create({
      userId: req.userId,
      caption,
      imageUri,
    });

    // ── @mention notifications ────────────────────────────────────────────────
  const handles = [];
const mentionRegex = /@([a-zA-Z0-9 ]+?)(?=\s{2,}|$|[^\w ])/g;
let match;
while ((match = mentionRegex.exec(caption)) !== null) {
  handles.push(match[1].trim());
}
console.log('📌 extracted handles:', handles);
    if (handles.length > 0) {
      const poster = await User.findById(req.userId).select('name');

      // Find all users whose name matches any @handle (case-insensitive)
const mentionedUsers = await User.find({
  $or: handles.map(h => ({ name: new RegExp(h.trim(), 'i') })),
  _id: { $ne: req.userId },
}).select('_id name');
console.log('📌 mentionedUsers found:', mentionedUsers.map(u => u.name));

console.log('📌 searching for handles:', handles);
console.log('📌 mentionedUsers found:', mentionedUsers.map(u => u.name));
console.log('📌 handles found:', handles);
console.log('📌 mentionedUsers found:', mentionedUsers.map(u => u.name));
await Promise.all(mentionedUsers.map(async (mentioned) => {
  const room = io.sockets.adapter.rooms.get(mentioned._id.toString());
  console.log(`📡 emitting to room ${mentioned._id}, room size: ${room ? room.size : 0}`);
  io.to(mentioned._id.toString()).emit('youWereMentioned', {
          postId:     post._id,
          mentionedBy: req.userId,
          name:       poster.name,
          caption,
        });

        // Push notification
        await sendPushNotification(
          mentioned._id,
          `${poster.name} mentioned you`,
          caption,
          req.userId
        );
      }));
    }
    // ─────────────────────────────────────────────────────────────────────────

    res.json({ status: 'ok', post });
  } catch (e) {
    console.error('POST /posts error:', e.message);
    res.status(500).json({ status: 'error', message: e.message });
  }
});

app.get('/user/:id/posts', auth, async (req, res) => {
  try {
    const posts = await Post.find({ userId: req.params.id })
      .sort({ createdAt: -1 });
    res.json({ status: 'ok', posts });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

app.post('/posts/:id/like', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ status: 'error' });
    const idx = post.likes.indexOf(req.userId);
    if (idx === -1) post.likes.push(req.userId);
    else post.likes.splice(idx, 1);
    await post.save();
    // after post.save()
const liker = await User.findById(req.userId).select('name');
io.to(String(post.userId)).emit('newLike', {
  postId: post._id,
  likerName: liker.name,
});
    res.json({ status: 'ok', likes: post.likes.length, liked: idx === -1 });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});
app.post('/posts/:id/share', auth, async (req, res) => {
  try {
    const { toUserId } = req.body;
    const post = await Post.findById(req.params.id).populate('userId', 'name');
    if (!post) return res.status(404).json({ status: 'error' });

    const match = await Match.findOne({ users: { $all: [req.userId, toUserId] } });
    if (!match) return res.status(403).json({ status: 'error', message: 'Not connected' });

    post.shares = (post.shares || 0) + 1;
    if (!post.sharedBy.map(String).includes(String(req.userId))) {
      post.sharedBy.push(req.userId);
    }
    await post.save();

    const shareText = `📤 Shared a post by ${post.userId?.name || 'someone'}:\n"${(post.caption || '').slice(0, 80)}${(post.caption?.length || 0) > 80 ? '…' : ''}"`;

    const sender = await User.findById(req.userId).select('name profileImage');
    const newMessage = new Message({
      senderId:   req.userId,
      receiverId: toUserId,
      message:    shareText,
      sharedPost: {
        postId:     post._id,
        caption:    post.caption || '',
        imageUri:   post.imageUri || null,
        authorName: post.userId?.name || '',
      },
      timestamp: new Date(),
    });
    await newMessage.save();

    await sendPushNotification(toUserId, sender.name, shareText, req.userId);

    io.to(toUserId).emit('newMessage', {
      _id:         newMessage._id,
      senderId:    req.userId,
      receiverId:  toUserId,
      message:     shareText,
      sharedPost:  newMessage.sharedPost,
      createdAt:   newMessage.timestamp,
      senderName:  sender.name,
      senderImage: sender.profileImage,
    });

    res.json({ status: 'ok', shares: post.shares });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});
app.get('/post/:id/likes-with-friends', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id).populate('likes', 'name profileImage');
    if (!post) return res.status(404).json({ status: 'error' });

    // Get all people current user is connected with
    const accepted = await ChatRequest.find({
      $or: [
        { userId: req.userId, status: 'accepted' },
        { otherUserId: req.userId, status: 'accepted' },
      ],
    });
    const matches = await Match.find({ users: req.userId });

    const connectedIds = accepted.map(r =>
      String(r.userId) === String(req.userId)
        ? String(r.otherUserId)
        : String(r.userId)
    );
    const matchedIds = matches.map(m =>
      String(m.users.find(u => String(u) !== String(req.userId)))
    );
    const allConnectedIds = [...new Set([...connectedIds, ...matchedIds])];

    // Filter likers to only those who are connected with current user
    const friendLikers = post.likes.filter(
      liker => allConnectedIds.includes(String(liker._id))
        && String(liker._id) !== String(req.userId)
    );

    const totalLikes = post.likes.length;

    res.json({ status: 'ok', friendLikers, totalLikes });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});
app.get('/user/:id/stats', auth, async (req, res) => {
  try {
    const userId = req.params.id;
    const connections = await Match.countDocuments({ users: userId });
    const userPosts = await Post.find({ userId });
    const totalLikes = userPosts.reduce((sum, p) => sum + (p.likes?.length || 0), 0);
    const followers = await ChatRequest.countDocuments({
      otherUserId: userId, status: 'accepted'
    });
    const posts = userPosts.length;
    res.json({ status: 'ok', connections, totalLikes, followers, posts });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});
// ── Start server ──────────────────────────────────────────────────────────────
server.listen(port, () => {
  console.log(`App listening on port ${port}`);
});
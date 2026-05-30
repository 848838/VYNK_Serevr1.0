const mongoose = require('mongoose');

const ChatmodalSchema = new mongoose.Schema({
    chatName: { type: String, required: true ,ref:'User' },
    isgroupChat: { type: mongoose.Schema.Types.ObjectId, },
    message: { type: String, required: true },
    user:[
        {
            type: String, required: true ,ref:'User'
        }
    ],
    latestMessage:{
        type: String, required: true ,ref:'User'

    },
    timestamp: { type: Date, default: Date.now },
});

const Chatmodal = mongoose.model('Chatmodal', ChatmodalSchema);

module.exports =  Chatmodal;
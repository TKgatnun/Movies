const mongoose = require('mongoose');

const HistorySchema = new mongoose.Schema({
    id: Number,
    type: String, 
    isAnime: Boolean,
    title: String,
    poster_path: String,
    season: Number,
    episode: Number,
    timestamp: { type: Date, default: Date.now }
});

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isVerified: { type: Boolean, default: false },
    verificationCode: String,
    history: [HistorySchema],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);

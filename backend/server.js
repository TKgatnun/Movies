const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/tkmovies')
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.log(err));

// User Model
const User = require('./models/User');

// Email Transporter
const transporter = nodemailer.createTransport({
    service: 'gmail', // or your SMTP provider
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// --- ROUTES ---

// 1. Signup & Send Verification Code
app.post('/api/auth/signup', async (req, res) => {
    const { email, password } = req.body;
    try {
        const existingUser = await User.findOne({ email });
        if (existingUser && existingUser.isVerified) return res.status(400).json({ message: 'User already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

        if (existingUser && !existingUser.isVerified) {
            // Update existing unverified user
            existingUser.password = hashedPassword;
            existingUser.verificationCode = verificationCode;
            await existingUser.save();
        } else {
            // Create new user
            await User.create({ email, password: hashedPassword, verificationCode });
        }

        // Send Email
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'TKmovies Verification Code',
            text: `Your verification code is: ${verificationCode}`
        });

        res.json({ message: 'Verification code sent to email' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error creating user' });
    }
});

// 2. Verify Code
app.post('/api/auth/verify', async (req, res) => {
    const { email, code } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: 'User not found' });
        if (user.verificationCode !== code) return res.status(400).json({ message: 'Invalid code' });

        user.isVerified = true;
        user.verificationCode = undefined;
        await user.save();

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
        res.json({ token, user: { email: user.email, history: user.history } });
    } catch (err) {
        res.status(500).json({ message: 'Verification failed' });
    }
});

// 3. Login
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: 'User not found' });
        if (!user.isVerified) return res.status(400).json({ message: 'Email not verified' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
        res.json({ token, user: { email: user.email, history: user.history } });
    } catch (err) {
        res.status(500).json({ message: 'Login failed' });
    }
});

// 4. Sync History
app.post('/api/user/history', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Unauthorized' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        const user = await User.findById(decoded.id);
        
        // Merge logic: Add new item to top, remove duplicates
        const newItem = req.body;
        user.history = user.history.filter(h => h.id !== newItem.id);
        user.history.unshift(newItem);
        if (user.history.length > 50) user.history.pop(); // Limit history

        await user.save();
        res.json(user.history);
    } catch (err) {
        res.status(500).json({ message: 'Error syncing history' });
    }
});

// 5. Get History
app.get('/api/user/history', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Unauthorized' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        const user = await User.findById(decoded.id);
        res.json(user.history);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching history' });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

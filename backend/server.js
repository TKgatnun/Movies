const express = require('express');
const cors = require('cors');
const downloadRoute = require('./download');

const app = express();
app.use(cors());

// Mount the download route so it matches the frontend request: /api/download
app.use('/api/download', downloadRoute);

// A simple health check route
app.get('/', (req, res) => res.send('Movies Backend is running without a database!'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

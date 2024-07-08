const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const { default: nodemon } = require('nodemon');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
const PORT = 1234;
const HOST = 'localhost'; // change always the host

// PostgreSQL configuration
const pool = new Pool({
    user: 'postgres', // Replace with your PostgreSQL username
    host: 'localhost', // do not change
    database: 'coffee-monitoring',
    password: 'admin', // Replace with your PostgreSQL password
    port: 5433,
});

const corsOptions = {
    origin: 'http://localhost:9000', // do note change
    credentials: true,            //access-control-allow-credentials:true
    optionSuccessStatus: 200
}

// Middleware for parsing JSON bodies
app.use(express.json());
app.use(cors(corsOptions));

// Endpoint to insert data
app.post('/insert_data', (req, res) => {
    const { humidity, temperature } = req.body;
    const createdAt = new Date().toISOString().split('T')[0]; // Create a date-only timestamp

    if (typeof humidity === 'number' && typeof temperature === 'number') {
        const query = 'INSERT INTO temperature_data (humidity, temperature, createdAt) VALUES ($1, $2, $3)';
        pool.query(query, [humidity, temperature, createdAt], (err, result) => {
            if (err) {
                console.error('Error inserting data:', err);
                res.status(500).send('Error inserting data');
                return;
            }
            console.log('Data inserted successfully');
            res.status(200).send('Data inserted successfully');
        });
    } else {
        res.status(400).send('Invalid data');
    }
});

// Route to get temperature data
app.get('/temperature', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM temperature_data ORDER BY id DESC');
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error executing query', error);
        res.status(500).json({ error: 'An error occurred' });
    }
});

const apiKey = '';
const senderAddress = 'SEMAPHORE'; // Replace with your sender name

// Function to generate report of highest and lowest temperature and humidity per day
const generateReport = async () => {
    try {
        const query = `
            SELECT 
                createdAt,
                MAX(temperature) AS highest_temperature,
                MIN(temperature) AS lowest_temperature,
                MAX(humidity) AS highest_humidity,
                MIN(humidity) AS lowest_humidity
            FROM 
                temperature_data
            WHERE 
                DATE(createdAt) = CURRENT_DATE
            GROUP BY 
                createdAt
            ORDER BY 
                createdAt;
        `;
        const { rows } = await pool.query(query); // Execute the query and get rows directly

        return rows; // Return the rows fetched from the database
    } catch (error) {
        console.error('Error generating report:', error);
        throw error; // Throw the error to be caught by the caller (endpoint handler)
    }
};

// Function to send SMS using Semaphore API
const sendSMS = async (message) => {
    try {
        const smsPayload = {
            apikey: apiKey,
            number: '', // Replace with the recipient's phone number
            message: message,
            sendername: senderAddress // Ensure this matches the approved sender name format
        };

        const response = await axios.post('https://api.semaphore.co/api/v4/messages', new URLSearchParams(smsPayload), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded' // Use URL-encoded format as in the PHP example
            }
        });

        console.log('SMS sent successfully:', response.data);
    } catch (error) {
        if (error.response) {
            // The request was made and the server responded with a status code
            console.error('Semaphore API responded with status code:', error.response.status);
            console.error('Response data:', error.response.data);
            console.error('Response headers:', error.response.headers);
        } else if (error.request) {
            // The request was made but no response was received
            console.error('No response received from Semaphore API:', error.request);
        } else {
            // Something happened in setting up the request that triggered an error
            console.error('Error setting up request to Semaphore API:', error.message);
        }
        throw error; // Rethrow the error for higher-level handling
    }
};

// Cron job to schedule report generation and check for abnormal conditions every hour
cron.schedule('*/5 * * * *', async () => {
    console.log('Running cron job to generate report and check abnormal conditions...');
    try {
        const report = await generateReport();

        report.forEach((dayReport) => {
            const { highest_temperature, lowest_temperature, highest_humidity, lowest_humidity } = dayReport;

            // Check for abnormal conditions
            if (highest_temperature > 59 || lowest_temperature < 40 || highest_humidity > 70 || lowest_humidity < 50) {
                const message = `ALERT: Abnormal conditions detected - Temperature: ${highest_temperature}°C/${lowest_temperature}°C, Humidity: ${highest_humidity}/${lowest_humidity}%`;
                sendSMS(message);
            }
        });

    } catch (error) {
        console.error('Error generating report or checking abnormal conditions:', error);
    }
}, {
    timezone: 'Asia/Manila' // Adjust timezone as needed
});

// Endpoint to manually trigger report generation and return the report
app.get('/generate_report', async (req, res) => {
    try {
        console.log('Manually triggering report generation...');
        const report = await generateReport();

        report.forEach((dayReport) => {
            const { highest_temperature, lowest_temperature, highest_humidity, lowest_humidity } = dayReport;

            // Check for abnormal conditions
            if (highest_temperature > 59 || lowest_temperature < 40 || highest_humidity > 70 || lowest_humidity < 50) {
                const message = `ALERT: Abnormal conditions detected - Temperature: ${highest_temperature}°C/${lowest_temperature}°C, Humidity: ${highest_humidity}/${lowest_humidity}%`;
                sendSMS(message);
            }
        });

        res.status(200).json(report); // Send the generated report as JSON response
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).send('Error generating report');
    }
});

// Start the server
app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});

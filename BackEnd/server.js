require('dotenv').config()

if (!process.env.GOOGLE_GEMINI_KEY) {
    console.error("Missing required environment variable: GOOGLE_GEMINI_KEY");
    process.exit(1);
}

if (!process.env.DATABASE_URL) {
    console.error("Missing required environment variable: DATABASE_URL");
    process.exit(1);
}

if (!process.env.JWT_SECRET) {
    console.error("Missing required environment variable: JWT_SECRET");
    process.exit(1);
}

const app = require('./src/app');
const { initDatabase } = require('./src/config/database');
const PORT = process.env.PORT || 3000;

initDatabase()
    .then(() => {
        const server = app.listen(PORT, () => {
            console.log(`Server is running on http://localhost:${PORT}`);
        })

        server.on('error', error => {
            if (error.code === 'EADDRINUSE') {
                console.error(`Port ${PORT} is already in use. Stop the other backend server or set a different PORT in .env.`)
                process.exit(1)
            }

            console.error('Server failed to start:', error.message)
            process.exit(1)
        })
    })
    .catch(error => {
        console.error('Failed to initialize database:', error)
        process.exit(1)
    })

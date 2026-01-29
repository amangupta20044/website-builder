import express, { Request, Response } from 'express';
import 'dotenv/config';
import cors from 'cors';
import { auth } from './lib/auth.js';
import { toNodeHandler } from 'better-auth/node';
import userRouter from './routes/userRoutes.js';
import projectRouter from './routes/projectRoutes.js';

const app = express();

const port = 3000;

const corsOptions = {
    origin: process.env.TRUSTED_ORIGINS?.split(',').map(o => o.trim()) || ['http://localhost:5173'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization','Cookie'],
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// app.use('/api/auth/{*any}', toNodeHandler(auth));
app.use('/api/auth', toNodeHandler(auth));

app.use(express.json({limit: '50mb'}));


app.get('/', (req: Request, res: Response) => {
    res.send('Server is Live!');
});
app.use('/api/user',userRouter);
app.use('/api/project',projectRouter);
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});






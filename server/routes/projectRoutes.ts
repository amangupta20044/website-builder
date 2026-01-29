import express from 'express';
import { protect } from '../middlewares/auth.js';
import {
    deleteProject,
    getProjectById,
    getProjectPreview,
    getPublishedProjects,
    makeRevision,
    rollbackToVersion,
    saveProjectCode
} from '../controllers/projectCotroller.js';

const projectRouter = express.Router();

projectRouter.get('/published', getPublishedProjects);
projectRouter.get('/published/:projectId', getProjectById);
projectRouter.post('/revision/:projectId', protect, makeRevision);
projectRouter.put('/save/:projectId', protect, saveProjectCode);
projectRouter.get('/rollback/:projectId/:versionId', protect, rollbackToVersion);
projectRouter.delete('/:projectId', protect, deleteProject);
projectRouter.get('/preview/:projectId', protect, getProjectPreview);

export default projectRouter;

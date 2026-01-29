import { Request, Response } from 'express'
import prisma from '../lib/prisma.js';


import { GoogleGenerativeAI } from "@google/generative-ai";

console.log(process.env.GEMINI_API_KEY);


// Controller Function to Make Revision
export const makeRevision = async (req: Request, res: Response) => {
    const userId = req.userId;

    try {

        const { projectId } = req.params;

        //  FIX — convert projectId to string
        const projectIdStr =
            Array.isArray(projectId) ? projectId[0] : projectId;

        const { message } = req.body;

        const user = await prisma.user.findUnique({
            where: { id: userId }
        })

        if (!userId || !user) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (user.credits < 5) {
            return res.status(403).json({ message: 'add more credits to make changes' });
        }

        if (!message || message.trim() === '') {
            return res.status(400).json({ message: 'Please enter a valid prompt' });
        }

        const currentProject = await prisma.websiteProject.findUnique({
            where: { id: projectIdStr, userId },
            include: { versions: true }
        })

        if (!currentProject) {
            return res.status(404).json({ message: 'Project not found' });
        }

        await prisma.conversation.create({
            data: {
                role: 'user',
                content: message,
                projectId: projectIdStr
            }
        })

        await prisma.user.update({
            where: { id: userId },
            data: { credits: { decrement: 5 } }
        })

        // enhance user prompts
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
        const geminiModel = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
        });

        const systemPrompt = `You are a prompt enhancement specialist. The user wants to make changes to their website. Enhance their request to be more specific and actionable for a web developer.
                         
                             Enhance this by:
                             1. Being specific about what elements to change
                             2. Mentioning design details (colors, spacing, sizes)
                             3. Clarifying the desired outcome
                             4. Using clear technical terms
                         
                         Return ONLY the enhanced request, nothing else. Keep it concise (1-2 sentences).`;

        const userPrompt = `User's request: "${message} "`;

        const prompt = `${systemPrompt}\n\n${userPrompt}`;

        const result = await geminiModel.generateContent(prompt);
        const response = await result.response;
        const enhancedPrompt = response.text();

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: `I've enhanced your prompt to: "${enhancedPrompt}"`,
                projectId: projectIdStr
            }
        });

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: 'Now making changes to your website...',
                projectId: projectIdStr
            }
        });

        // Generate website code
        const codeGenerationSystemPrompt = `You are an expert web developer. 

                    CRITICAL REQUIREMENTS:
                    - Return ONLY the complete updated HTML code with the requested changes.
                    - Use Tailwind CSS for ALL styling (NO custom CSS).
                    - Use Tailwind utility classes for all styling changes.
                    - Include all JavaScript in <script> tags before closing </body>
                    - Make sure it's a complete, standalone HTML document with Tailwind CSS
                    - Return the HTML Code Only, nothing else
                
                    Apply the requested changes while maintaining the Tailwind CSS styling approach.`;
        
        const codeGenerationUserPrompt = `Here is the corrent website code : "${currentProject.current_code} " The user wants this change : "${enhancedPrompt}"`;

        const codeGenerationPrompt = `${codeGenerationSystemPrompt}\n\n${codeGenerationUserPrompt}`;

        const codeGenerationResult = await geminiModel.generateContent(codeGenerationPrompt);
        const codeGenerationResponse = await codeGenerationResult.response;
        const code = codeGenerationResponse.text();

        if (!code) {
            await prisma.conversation.create({
                data: {
                    role: 'assistant',
                    content: "Unable to generate the code, please try again",
                    projectId: projectIdStr   // ✅ must be string
                }
            })

            await prisma.user.update({
                where: { id: userId },
                data: { credits: { increment: 5 } }
            })

            return ;
        }

        const version = await prisma.version.create({
            data: {
                code: code.replace(/```[a-z]*\n?/gi, '')
                    .replace(/```$/g, '')
                    .trim(),
                description: 'changes made',
                projectId: projectIdStr
            }
        })

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: "I've made the changes to your website! You can now preview it",
                projectId: projectIdStr
            }
        })

        await prisma.websiteProject.update({
            where: { id: projectIdStr },
            data: {
                current_code: code.replace(/```[a-z]*\n?/gi, '')
                    .replace(/```$/g, '')
                    .trim(),
                current_version_index: version.id
            }
        })

        res.json({ message: 'changes made successfully' })

    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

// Controller Function to rollback to a specific version
export const rollbackToVersion = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const { projectId, versionId } = req.params;

        // ✅ FIX — convert params to string
        const projectIdStr =
            Array.isArray(projectId) ? projectId[0] : projectId;

        const versionIdStr =
            Array.isArray(versionId) ? versionId[0] : versionId;

        const project = await prisma.websiteProject.findUnique({
            where: { id: projectIdStr, userId },
            include: { versions: true }
        })

        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        const version = project.versions.find(
            (version) => version.id === versionIdStr
        );

        if (!version) {
            return res.status(404).json({ message: 'Version not found' });
        }

        await prisma.websiteProject.update({
            where: { id: projectIdStr, userId },
            data: {
                current_code: version.code,
                current_version_index: version.id
            }
        })

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: "I have rolled back your website to select version.You can now preview it",
                projectId: projectIdStr
            }
        })

        res.json({ message: 'rollback successful' });

    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message })
    }
}

// Controller Function to Delete a Project
export const deleteProject = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;

        const { projectId } = req.params;

        // ✅ FIX: convert param to string
        const projectIdStr =
            Array.isArray(projectId) ? projectId[0] : projectId;

        await prisma.websiteProject.delete({
            where: { id: projectIdStr, userId },
        })

        res.json({ message: 'Project deleted successfully' });

    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

// Controller for getting project code for preview
export const getProjectPreview = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        const { projectId } = req.params;

        // ✅ FIX 1: convert param to string
        const projectIdStr =
            Array.isArray(projectId) ? projectId[0] : projectId;

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const project = await prisma.websiteProject.findFirst({
            where: { id: projectIdStr, userId },
            include: { versions: true }
        })

        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }
        res.json({
            project
        });

    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

// Get published projects
export const getPublishedProjects = async (req: Request, res: Response) => {
    try {

        const projects = await prisma.websiteProject.findMany({
            where: { isPublished: true },
            include: { user: true }
        })

        res.json({ projects });

    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

// Get a single project by id
export const getProjectById = async (req: Request, res: Response) => {
    try {
        const { projectId } = req.params;

        // ✅ FIX
        const projectIdStr =
            Array.isArray(projectId) ? projectId[0] : projectId;

        const project = await prisma.websiteProject.findFirst({
            where: { id: projectIdStr },
        })

        if (!project || project.isPublished === false || !project?.current_code) {
            return res.status(404).json({ message: 'Project not found' });
        }

        res.json({ code: project.current_code });

    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

// Controller to save project code
export const saveProjectCode = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        const { projectId } = req.params;
        const { code } = req.body;

        // ✅ FIX: params type issue
        const projectIdStr =
            Array.isArray(projectId) ? projectId[0] : projectId;

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!code) {
            return res.status(400).json({ message: 'Code is required' });
        }

        const project = await prisma.websiteProject.findUnique({
            where: { id: projectIdStr, userId }
        });

        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        await prisma.websiteProject.update({
            where: { id: projectIdStr },
            data: {
                current_code: code,
                current_version_index: ''
            }
        });

        res.json({ message: 'Project saved successfully' });

    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
};
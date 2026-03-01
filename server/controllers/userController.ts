import { Request, Response } from 'express'
import prisma from '../lib/prisma.js';
import { GoogleGenAI } from "@google/genai";
import dotenv from 'dotenv';
dotenv.config();

console.log("------", process.env.GEMINI_API_KEY);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Get User Credits
export const getUserCredits = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        return res.json({ credits: user?.credits ?? 0 });
    } catch (error: any) {
        console.log(error.code || error.message);
        return res.status(500).json({ message: error.message });
    }
};

// controller function to create new project
export const createUserProject = async (req: Request, res: Response) => {
    const userId = req.userId;

    console.log(`Creating project for user: ---------------------->>>>>>>>>>>>>>>>> ${userId}`);

    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    let project: any = null;

    try {
        const { initial_prompt } = req.body;

        console.log(`Initial prompt: ---------------------->>>>>>>>>>>>>>>>>
            
            
            --------------${initial_prompt}`);

        if (!initial_prompt) {
            return res.status(400).json({ message: 'Initial prompt is required' });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.credits < 5) {
            return res.status(403).json({ message: 'Add credits to create more projects' });
        }

        // Create a new project
        project = await prisma.websiteProject.create({
            data: {
                name:
                    initial_prompt.length > 50
                        ? initial_prompt.substring(0, 47) + '...'
                        : initial_prompt,
                initial_prompt,
                userId
            }
        });

        // Update User's Total Creation
        await prisma.user.update({
            where: { id: userId },
            data: { totalCreation: { increment: 1 } }
        });

        await prisma.conversation.create({
            data: {
                role: 'user',
                content: initial_prompt,
                projectId: project.id
            }
        });

        // Deduct credits
        await prisma.user.update({
            where: { id: userId },
            data: { credits: { decrement: 5 } }
        });

        console.log("------", process.env.GEMINI_API_KEY);

        // Enhance user prompt
        const promptEnhanceSystemPrompt = `
            You are a prompt enhancement specialist. Take the user's website request and expand it into a detailed, comprehensive prompt that will help create the best possible website.
            Enhance this prompt by:
            1. Adding specific design details (layout, color scheme, typography)
            2. Specifying key sections and features
            3. Describing the user experience and interactions
            4. Including modern web design best practices
            5. Mentioning responsive design requirements
            6. Adding any missing but important elements
            
            Return ONLY the enhanced prompt, nothing else. Make it detailed but concise (2-3 paragraphs max).`;

        console.log('\n📝 Enhancing prompt...\n');
        const enhancedPrompt = await generateContent(
            `${promptEnhanceSystemPrompt}\n\nUser request: ${initial_prompt}`,
            'Enhanced Prompt'
        );

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: `I've enhanced your prompt to: "${enhancedPrompt}"`,
                projectId: project.id
            }
        });

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: 'Now generating your website...',
                projectId: project.id
            }
        });

        // Add delay between API calls to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Generate website code
        const codeGenerationSystemPrompt = `
            You are an expert web developer. Create a complete, production-ready, single-page website based on this request: "${enhancedPrompt}"
        
            CRITICAL REQUIREMENTS:
            - You MUST output valid HTML ONLY. 
            - Use Tailwind CSS for ALL styling
            - Include this EXACT script in the <head>: <script src="https://cdn.tailwindcss.com"></script>
            - Use Tailwind utility classes extensively for styling, animations, and responsiveness
            - Make it fully functional and interactive with JavaScript in <script> tag before closing </body>
            - Use modern, beautiful design with great UX using Tailwind classes
            - Make it responsive using Tailwind responsive classes (sm:, md:, lg:, xl:)
            - Use Tailwind animations and transitions (animate-*, transition-*)
            - Include all necessary meta tags
            - Use Google Fonts CDN if needed for custom fonts
            - Use placeholder images from https://placehold.co/600x400
            - Use Tailwind gradient classes for beautiful backgrounds
            - Make sure all buttons, cards, and components use Tailwind styling
        
            CRITICAL HARD RULES:
            1. Output ONLY the HTML code, nothing else.
            2. Do NOT include markdown, explanations, notes, or code fences.
            3. The HTML should be complete and ready to render as-is with Tailwind CSS.`;

        console.log('\n🌐 Generating website code...\n');
        const code = await generateContent(
            `${codeGenerationSystemPrompt}\n\n${enhancedPrompt}`,
            'Website Code'
        );

        if (!code) {
            await prisma.conversation.create({
                data: {
                    role: 'assistant',
                    content: "Unable to generate the code, please try again",
                    projectId: project.id
                }
            });

            // Refund credits
            await prisma.user.update({
                where: { id: userId },
                data: { credits: { increment: 5 } }
            });

            return res.status(500).json({ message: 'Failed to generate website code' });
        }

        // Clean the generated code
        const cleanedCode = code
            .replace(/```[a-z]*\n?/gi, '')
            .replace(/```$/g, '')
            .trim();

        // Create Version for the project
        const version = await prisma.version.create({
            data: {
                code: cleanedCode,
                description: 'Initial version',
                projectId: project.id
            }
        });

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: "I've created your website! You can now preview it and request any changes.",
                projectId: project.id
            }
        });

        await prisma.websiteProject.update({
            where: { id: project.id },
            data: {
                current_code: cleanedCode,
                current_version_index: version.id
            }
        });

        return res.json({ projectId: project.id });

    } catch (error: any) {
        console.error('Error creating project:', error.code || error.message);
        
        // Refund credits if project was created
        if (project) {
            try {
                await prisma.user.update({
                    where: { id: userId },
                    data: { credits: { increment: 5 } }
                });
            } catch (refundError) {
                console.error('Failed to refund credits:', refundError);
            }
        }
        
        return res.status(500).json({ message: error.message || 'Internal server error' });
    }
};

// Controller Function to Get A Single User Project
export const getUserProject = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const projectId = req.params.projectId as string;

        const project = await prisma.websiteProject.findUnique({
            where: { id: projectId, userId },
            include: {
                conversation: {
                    orderBy: { timestamp: 'asc' }
                },
                versions: { orderBy: { timestamp: 'asc' } }
            }
        });

        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        return res.json({ project });

    } catch (error: any) {
        console.log(error.code || error.message);
        return res.status(500).json({ message: error.message });
    }
};

// Controller Function to Get All Users Projects
export const getUserProjects = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const projects = await prisma.websiteProject.findMany({
            where: { userId },
            orderBy: { updatedAt: 'desc' }
        });

        return res.json({ projects });

    } catch (error: any) {
        console.log(error.code || error.message);
        return res.status(500).json({ message: error.message });
    }
};

// Controller Function to Toggle Project Publish
export const togglePublish = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const projectId = req.params.projectId as string;

        const project = await prisma.websiteProject.findUnique({
            where: { id: projectId, userId }
        });

        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        await prisma.websiteProject.update({
            where: { id: projectId },
            data: { isPublished: !project.isPublished }
        });

        return res.json({
            message: project.isPublished
                ? 'Project Unpublished'
                : 'Project Published Successfully'
        });
    } catch (error: any) {
        console.log(error.code || error.message);
        return res.status(500).json({ message: error.message });
    }
};

// controller function to purchase credits
export const purchaseCredits = async (req: Request, res: Response) => {
    try {
        return res.json({ message: 'Purchase credits endpoint' });
    } catch (error: any) {
        console.log(error.code || error.message);
        return res.status(500).json({ message: error.message });
    }
};

// Helper function for content generation (non-streaming)
async function generateContent(
    prompt: string,
    label: string = 'Response'
): Promise<string> {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🚀 Starting generation: ${label}`);
    console.log(`${'='.repeat(50)}\n`);

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt
    });

    const text = response.text || '';
    
    console.log(text);
    console.log(`\n${'='.repeat(50)}`);
    console.log(`✅ Generation complete: ${label}`);
    console.log(`📊 Total characters: ${text.length}`);
    console.log(`${'='.repeat(50)}\n`);

    return text;
}

// Helper function for retrying API calls with backoff
async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 5,
    baseDelay: number = 10000
): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error: any) {
            const isRateLimited = error.message?.includes('429') || 
                                  error.message?.includes('RESOURCE_EXHAUSTED') ||
                                  error.status === 429;
            
            if (isRateLimited && i < maxRetries - 1) {
                const delay = baseDelay * Math.pow(2, i);
                console.log(`\n⚠️ Rate limited. Attempt ${i + 1}/${maxRetries}. Retrying in ${delay / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
    throw new Error('Max retries exceeded');
}

// Add a delay helper between API calls
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
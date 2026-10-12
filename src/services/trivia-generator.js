import 'dotenv/config';
import connectDB from '../db.js';
import Character from '../models/Character.js';
import Trivia from '../models/Trivia.js';
import { llmJSON } from './extract.js';

const TRIVIA_SCHEMA = {
    type: "object",
    properties: {
        questions: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    question: { type: "string" },
                    options: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
                    answer: { type: "string" },
                    explanation: { type: "string" },
                    difficulty: { type: "string", enum: ["easy", "medium", "hard"] }
                },
                required: ["question", "options", "answer", "explanation"]
            }
        }
    },
    required: ["questions"]
};

async function generateBatchChunk(fandomKey, sampleDocs, count = 20) {
    const context = sampleDocs.map(c => `- ${c.name}: ${c.description || 'No description available.'}`).join('\n');

    const prompt = `Generate exactly ${count} multiple-choice trivia questions based strictly on the following ${fandomKey} lore.
Ensure each question has 4 unique options and accurately identifies the correct answer.

LORE CONTEXT:
${context}`;

    const response = await llmJSON([
        { role: 'system', content: `You extract trivia into JSON matching this schema: ${JSON.stringify(TRIVIA_SCHEMA)}` },
        { role: 'user', content: prompt }
    ], { temperature: 0.7 });
    return response.questions || [];
}

export async function generateTriviaBatch(fandomKey, targetCount = 100) {
    console.log(`\n🧠 Generating ${targetCount} trivia questions for "${fandomKey}"...`);
    let totalGenerated = 0;
    const batchSize = 20;

    while (totalGenerated < targetCount) {
        const sampleSize = 15;
        const sampleDocs = await Character.aggregate([
            { $match: { fandom: fandomKey } },
            { $sample: { size: sampleSize } }
        ]);

        if (sampleDocs.length === 0) {
            console.warn(`No character documents found for fandom "${fandomKey}" to generate trivia.`);
            break;
        }

        try {
            const questions = await generateBatchChunk(fandomKey, sampleDocs, batchSize);
            if (questions.length > 0) {
                const docsToInsert = questions.map(q => ({ ...q, fandom: fandomKey }));
                await Trivia.insertMany(docsToInsert);
                totalGenerated += docsToInsert.length;
                console.log(`Saved ${totalGenerated}/${targetCount} questions to MongoDB.`);
            }
        } catch (err) {
            console.error('Batch generation error:', err.message);
            break;
        }
    }
}

// CLI: node src/services/trivia-generator.js <fandomKey> [count]
const [cliFandom, cliCount] = process.argv.slice(2);
if (cliFandom) {
    await connectDB();
    await generateTriviaBatch(cliFandom, Number(cliCount) || 100);
    process.exit(0);
}

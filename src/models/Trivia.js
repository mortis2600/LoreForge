import mongoose from 'mongoose';

const triviaSchema = new mongoose.Schema({
    fandom: { type: String, required: true, index: true },
    question: { type: String, required: true },
    options: [{ type: String, required: true }],
    answer: { type: String, required: true },
    explanation: { type: String },
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
    created_at: { type: Date, default: Date.now }
});

export default mongoose.model('Trivia', triviaSchema);

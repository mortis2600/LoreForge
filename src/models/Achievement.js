import mongoose from 'mongoose';

const achievementSchema = new mongoose.Schema({
  title: { type: String, required: true, unique: true },
  description: { type: String, required: true },
  recipient: { type: String, description: "Who received this achievement?" },
  floor: { type: Number, description: "The floor level where it was awarded" },
  reward: { type: String, description: "What did they get? e.g., Platinum Celestial Box" },
  category: { type: String, description: "e.g., Bronze, Silver, Gold, Celestial" },
  ai_flavor_text: { type: String, default: null },
  mechanic_summary: { type: String, default: null },
  source: { type: String, enum: ['wiki', 'book'], default: 'wiki' },
  book: { type: Number, default: null },
  chapter: { type: String, default: null },
  last_updated: { type: Date, default: Date.now }
});

export default mongoose.model('Achievement', achievementSchema);

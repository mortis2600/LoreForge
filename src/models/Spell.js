import mongoose from 'mongoose';

const spellSchema = new mongoose.Schema({
    fandom: { type: String, required: true, index: true },
    name: { type: String, required: true },
    school: { type: String, default: 'Unknown' },
    level: { type: Number, default: 0 },
    casting_time: { type: String },
    range: { type: String },
    duration: { type: String },
    description: { type: String },
    image_url: { type: String, default: null },
    last_updated: { type: Date, default: Date.now }
});

spellSchema.index({ fandom: 1, name: 1 }, { unique: true });

export default mongoose.model('Spell', spellSchema);

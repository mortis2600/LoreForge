import mongoose from 'mongoose';

const itemSchema = new mongoose.Schema({
    fandom: { type: String, required: true, index: true },
    name: { type: String, required: true },
    type: { type: String, default: 'Item' },
    rarity: { type: String, default: 'Common' },
    description: { type: String },
    effects: [{ type: String }],
    image_url: { type: String, default: null },
    last_updated: { type: Date, default: Date.now }
});

itemSchema.index({ fandom: 1, name: 1 }, { unique: true });

export default mongoose.model('Item', itemSchema);

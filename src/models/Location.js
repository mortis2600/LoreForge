import mongoose from 'mongoose';

const locationSchema = new mongoose.Schema({
    fandom: { type: String, required: true, index: true },
    name: { type: String, required: true },
    region: { type: String },
    type: { type: String }, // e.g., City, Dungeon, Planet
    description: { type: String },
    image_url: { type: String, default: null },
    last_updated: { type: Date, default: Date.now }
});

locationSchema.index({ fandom: 1, name: 1 }, { unique: true });

export default mongoose.model('Location', locationSchema);

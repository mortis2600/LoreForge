import mongoose from 'mongoose';

const characterSchema = new mongoose.Schema({
    fandom: { type: String, required: true, index: true },
    name: { type: String, required: true },
    aliases: [{ type: String }],
    species: { type: String, default: 'Unknown' },
    class: { type: String },
    level: { type: Number, default: 0 },
    origin: { type: String },
    is_crawler: { type: Boolean, default: false },
    crawler_number: { type: String },
    affiliations: [{ type: String }],
    status: { type: String, default: 'Unknown' },
    description: { type: String },
    image_url: { type: String, default: null },
    source: { type: String, default: "wiki" },
    book: { type: Number },
    last_updated: { type: Date, default: Date.now }
});

characterSchema.index({ fandom: 1, name: 1 }, { unique: true });

export default mongoose.model('Character', characterSchema);

import mongoose from 'mongoose';

const kinkTermSchema = new mongoose.Schema({
    term: { type: String, required: true },
    definition: { type: String, required: true },
    category: { type: String, required: true, index: true },
    source: { type: String, default: 'kinktionary' }
});
kinkTermSchema.index({ term: 1 }, { unique: true });

export default mongoose.model('KinkTerm', kinkTermSchema);

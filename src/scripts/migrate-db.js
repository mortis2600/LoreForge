import 'dotenv/config';
import connectDB from '../db.js';
import Character from '../models/Character.js';
import Item from '../models/Item.js';

async function migrate() {
    await connectDB();
    console.log('Running database migration...');

    // 1. Drop the old restrictive index
    try {
        await Character.collection.dropIndex('name_1');
        await Item.collection.dropIndex('name_1');
        console.log('✅ Dropped legacy name_1 indexes.');
    } catch (e) {
        console.log('✅ Legacy indexes already handled.');
    }

    // 2. Remove the Discworld characters from the earlier run (they lack the fandom tag)
    const deleted = await Character.deleteMany({ 
        fandom: { $exists: false }, 
        image_url: { $regex: 'discworld', $options: 'i' } 
    });
    console.log(`✅ Cleared ${deleted.deletedCount} untagged Discworld records.`);

    // 3. Update all remaining untagged records (DCC) to have the correct fandom tag
    const updatedChars = await Character.updateMany(
        { fandom: { $exists: false } },
        { $set: { fandom: 'dungeon_crawler_carl' } }
    );
    const updatedItems = await Item.updateMany(
        { fandom: { $exists: false } },
        { $set: { fandom: 'dungeon_crawler_carl' } }
    );
    
    console.log(`✅ Tagged ${updatedChars.modifiedCount} legacy characters and ${updatedItems.modifiedCount} legacy items with 'dungeon_crawler_carl'.`);
    
    // 4. Force Mongoose to build the new compound indexes
    await Character.syncIndexes();
    await Item.syncIndexes();
    console.log('✅ New multi-fandom indexes built successfully.');

    process.exit(0);
}

migrate();

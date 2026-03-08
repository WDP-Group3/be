import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
    cloud_name: 'duweanlqq',
    api_key: '536861784761471',
    api_secret: 'OoB3S-zd17a7C_uiR52P8S2B3l4'
});

async function main() {
    try {
        const res = await cloudinary.api.create_upload_preset({
            name: 'drivecenter_preset',
            unsigned: true,
            folder: 'course_images'
        });
        console.log('Success! Preset created:', res.name);
    } catch (err) {
        if (err.error && err.error.message && err.error.message.includes('already exists')) {
            console.log('Success! Preset early created:', 'drivecenter_preset');
        } else {
            console.error('Error creating preset:', err);
        }
    }
}

main();

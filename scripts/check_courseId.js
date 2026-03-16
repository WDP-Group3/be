import fs from 'fs';
import path from 'path';

const registrationsFile = '/Users/nguyenminhanh/Downloads/banglaixe.registrations.json';
const registrations = JSON.parse(fs.readFileSync(registrationsFile, 'utf8'));

const withCourseId = registrations.filter(r => r.courseId).length;
const withoutCourseId = registrations.filter(r => !r.courseId).length;

console.log(`Registrations with courseId: ${withCourseId}`);
console.log(`Registrations without courseId: ${withoutCourseId}`);
if (withoutCourseId > 0) {
    console.log("Sample without courseId:", JSON.stringify(registrations.find(r => !r.courseId), null, 2));
}

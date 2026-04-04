const mongoose = require('mongoose');
mongoose.connect('mongodb+srv://admin:admin123%40@banglaixe.8aade9o.mongodb.net/banglaixe

const logReg = async () => {
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false, collection: 'users' }));
  const Registration = mongoose.model('Registration', new mongoose.Schema({}, { strict: false, collection: 'registrations' }));
  
  const user = await User.findOne({ fullName: /user 3/i });
  if (!user) { console.log('user NOT FOUND'); process.exit(); }
  console.log('USER ID:', user._id);
  
  const regs = await Registration.find({ learnerId: user._id }).lean();
  console.log('Registrations:');
  console.dir(regs, { depth: null });
  
  process.exit();
}
logReg();

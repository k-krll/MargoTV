const mongoose = require('mongoose');

const encodingSchema = new mongoose.Schema({
  videoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Video'
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'error'],
    default: 'pending'
  },
  progress: {
    type: Number,
    default: 0
  },
  error: String,
  startTime: Date,
  endTime: Date,
  duration: Number,
  currentTime: Number,
  qualities: [{
    resolution: String,
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'error'],
      default: 'pending'
    },
    progress: {
      type: Number,
      default: 0
    },
    path: String
  }],
  selectedQualities: [String]
});

module.exports = mongoose.model('Encoding', encodingSchema); 
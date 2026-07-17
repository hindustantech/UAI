// const mongoose = require('mongoose');
import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  uid: {
    type: String, unique: true
  },
  name: {
    type: String,
    required: false
  },
  email: {
    type: String,
  }

  ,
  whatsapp_uid: {
    type: String,
    maxlength: 500 // Increased length to handle long UIDs
  },
  password: {
    type: String,
    required: false
  },

  suspend: {
    type: Boolean,
    default: false
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  referalCode: {
    type: String,
    unique: true,
    sparse: true
  },
  referrelCommisationType: {
    type: String,
    enum: ["fixed", "percentage"], // enum values must be strings
    default: "fixed", // you can set default as "fixed" or "percentage"
  },

  referrelCommisation: {
    type: Number, // should be Number, not String or Boolean
    default: 0,   // default commission value
  },
  referredBy: {
    type: String,
    default: null
  },

  // referaluseCount: {
  //   type: Number,
  //   default: 0
  // },

  referaluseCount: {
    type: String,
    default: false
  },
  isProfileCompleted: {
    type: Boolean,
    default: false
  },
  type: {
    type: String,
    required: true,
    enum: ['user', 'partner', 'agency', 'admin', 'super_admin'],
    default: 'user'
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    required: false
  },
  phone: {
    type: String,
    required: false
  },
  profileImage: {
    type: String,
    required: false,
    unique: false
  },
  createdCouponsId: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'Coupon',
    default: []
  },
  devicetoken: {
    type: String,
  },
  availedCouponsId: [
    {
      couponId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Coupon'
      },
      dateAdded: {
        type: Date,
        default: Date.now
      },
      status: {
        type: String,
        enum: ['ACTIVE', 'EXPIRED', 'REDEEMED'],
        default: 'REDEEMED'
      },
      totalPrice: {
        type: Number,
        required: true,
        default: 0
      }
    }
  ],

  couponCount: {
    type: Number,
    required: true,
    default: 5
  },

  manul_address: {
    type: String,
    trim: true,
    index: true, // 🔑 fast lookup

  },
  deviceId: {
    type: String,
  }
  ,
  corpareteUser: {
    type: Boolean,
    default: false
  },


  permissions: [
    {
      type: String,
      lowercase: true, // ensure keys like 'user.create' are always lowercase
      trim: true,
    }
  ],
  // Store latest location in GeoJSON format
  latestLocation: {
    type: {
      type: String,
      enum: ["Point"],
      default: "Point",
    },
    coordinates: {
      type: [Number], // [lng, lat]
      default: [0, 0],
    },
  }
  ,

  // Add inside userSchema

  accountStatus: {
    type: String,
    enum: ["ACTIVE", "SUSPENDED", "PENDING_DELETION", "DELETED"],
    default: "ACTIVE",
    index: true
  },

  suspendedAt: {
    type: Date,
    default: null
  },

  deletionRequestedAt: {
    type: Date,
    default: null
  },

  scheduledDeletionAt: {
    type: Date,
    default: null,
    index: true
  },

  deletedAt: {
    type: Date,
    default: null
  },

  deletionReason: {
    type: String,
    default: null
  },
  oauthProviders: {
    google: {
      id: String,
      email: String,
    }
  },

  googleId: {
    type: String,
    unique: true,
    sparse: true, // Allows null/undefined values
    index: true
  },
  isGoogleVerified: {
    type: Boolean,
    default: false
  },
  googleEmail: {
    type: String,
    lowercase: true,
    trim: true,
    sparse: true
  },
  googleProfilePicture: {
    type: String,
    required: false
  },
  authProvider: {
    type: String,
    enum: ['local', 'google', 'whatsapp', 'both'],
    default: 'local'
  },
  emailVerificationStatus: {
    type: String,
    enum: ['pending', 'verified', 'failed', 'not_applicable'],
    default: 'pending'
  },
  emailVerifiedAt: {
    type: Date,
    default: null
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },


}, {
  timestamps: true
});

// Generate a unique ID field with format of U-xxxxxx, ensuring both letters and numbers
userSchema.pre('save', async function (next) {
  let isUnique = false;
  let attempts = 0;
  const maxAttempts = 5;

  const generateAlphanumeric = () => {
    const numbers = '0123456789';
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    // Ensure at least one number and one letter
    const randomNumber = numbers[Math.floor(Math.random() * numbers.length)];
    const randomLetter = letters[Math.floor(Math.random() * letters.length)];

    // Generate the remaining 4 characters
    let remaining = '';
    const allChars = numbers + letters;
    for (let i = 0; i < 4; i++) {
      remaining += allChars[Math.floor(Math.random() * allChars.length)];
    }

    // Mix them together randomly
    const combined = randomNumber + randomLetter + remaining;
    return 'U-' + combined.split('').sort(() => Math.random() - 0.5).join('');
  };

  while (!isUnique && attempts < maxAttempts) {
    const generatedUid = generateAlphanumeric();
    const existingUser = await mongoose.model('User').findOne({ uid: generatedUid });

    if (!existingUser) {
      this.uid = generatedUid;
      isUnique = true;
    }
    attempts++;
  }

  if (!isUnique) {
    return next(new Error('Could not generate unique UID after maximum attempts'));
  }
  next();
});

userSchema.index({ latestLocation: "2dsphere" });
// userSchema.index({ deviceId: 1 }, { unique: true });

// userSchema.index({ referalCode: 1 });
const User = mongoose.model('User', userSchema);
export default User;

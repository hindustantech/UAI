// import admin from "./firebaseadmin.js";
import notification from "../models/notification.js";


/**
 * Send push notification to a specific user
 * @param {string} deviceToken - The FCM device token of the user
 * @param {string} title - Notification title
 * @param {string} body - Notification message body
 * @param {object} [data={}] - Optional custom data
 * @returns {Promise<object>} - Firebase response
 */
export const sendNotification = async (deviceToken, title, body, data = {}) => {
  try {
    const message = {
      token: deviceToken,
      notification: {
        title,
        body,
      },
      data: {
        click_action: 'FLUTTER_NOTIFICATION_CLICK', // for React Native or Flutter apps
        ...data,
      },
    };

    const response = await admin.messaging().send(message);
  
    return { success: true, response };
  } catch (error) {
    
    return { success: false, error };
  }
};




/**
 * Send and store notifications
 * @param {Object} options
 * @param {String} options.type - "global" | "location" | "user"
 * @param {String} options.title
 * @param {String} options.message
 * @param {String} [options.location] - only if type = "location"
 * @param {String[]} [options.userIds] - only if type = "user"
 * @param {String} [options.createdBy]
 */
export const createAndSendNotification = async ({
  type,
  title,
  message,
  location,
  userIds,
  createdBy,
}) => {
  try {
    let targetUsers = [];

    // Determine target users based on type
    if (type === 'global') {
      targetUsers = await User.find({ deviceToken: { $exists: true, $ne: null } });
    } else if (type === 'location') {
      targetUsers = await User.find({
        address: { $regex: new RegExp(location, 'i') },
        deviceToken: { $exists: true, $ne: null },
      });
    } else if (type === 'user' && Array.isArray(userIds)) {
      targetUsers = await User.find({
        _id: { $in: userIds },
        deviceToken: { $exists: true, $ne: null },
      });
    }

    // Extract device tokens
    const tokens = targetUsers.map((u) => u.deviceToken).filter(Boolean);

    // 🔥 Send push notifications
    if (tokens.length > 0) {
      const messagePayload = {
        notification: { title, body: message },
        tokens,
      };

      const response = await admin.messaging().sendMulticast(messagePayload);
     
    } 

    // 🧾 Save to MongoDB
    const notifications = new notification({
      title,
      message,
      type,
      location: type === 'location' ? location : undefined,
      users: type === 'user' ? userIds : [],
      createdBy,
    });

    await notifications.save();


    return { success: true, notification };
  } catch (error) {
   
    return { success: false, error };
  }
};

// const axios = require('axios');
import axios from 'axios';

const getGoogleOAuthToken = async (code) => {
  const url = 'https://oauth2.googleapis.com/token';

  const values = {
    code, 
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    grant_type: 'authorization_code',
  };

  const res = await axios.post(url, values, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  
  return res.data;
};

const getGoogleUserInfo = async (id_token, access_token) => {
  const url = `https://www.googleapis.com/oauth2/v1/userinfo?alt=json&access_token=${access_token}`;

  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${id_token}` },
  });

  return res.data;
};

export { getGoogleOAuthToken, getGoogleUserInfo };

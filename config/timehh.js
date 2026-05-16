// utils/time.js

export const convertMinutesToHHMM = (minutes) => {

    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;

    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
};
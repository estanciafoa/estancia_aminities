// Inspirational confirmation messages shown on the home screen after a
// successful check-in / check-out. A message is picked at random.

const CHECKIN_MESSAGES = [
  'Check-in successful! Have a great workout! 💪',
  "You're checked in! Enjoy your session!",
  'Check-in complete! Make it count today!',
  'Welcome in! Have an amazing workout!',
  "You're all set! Stay strong and crush it!",
  'Successfully checked in. Time to get moving!',
  'Check-in done! Give it your best today!',
  "You're in! Have a fantastic session!",
  "Checked in! Let's make today count!",
  'Welcome! Enjoy every rep and set!',
  "You're good to go! Have a powerful workout!",
  'Check-in confirmed! Push your limits today!',
  'All set! Have a great time at the gym!',
  'Checked in successfully! Stay focused and strong!',
  "You're in! Time to build a better you!",
  'Check-in complete! Enjoy your training!',
  'Welcome aboard! Have a killer workout!',
  'Successfully checked in! Make every set count!',
  "You're checked in! Go smash your goals!",
  'Check-in done! Have a wonderful session!',
  'All good! Enjoy your time at the gym!',
  'Checked in! Stay motivated and keep pushing!',
  "You're set! Have an incredible workout!",
  'Check-in successful! Your body will thank you!',
  'Welcome in! Train hard and have fun!',
  "You're checked in! Consistency is key — keep going!",
  'Check-in confirmed! Have an energetic session!',
  'All set! Give 100% and enjoy the process!',
  'Checked in! Another day, another step forward!',
  "You're in! Have a healthy and happy workout!",
  "Check-in complete! You showed up — that's half the battle!",
  'Successfully checked in! Own your workout today!',
  'Welcome! Stay strong, stay consistent!',
  "You're good to go! Enjoy the grind!",
  "Checked in! Make today's workout your best yet!",
  'Check-in done! Have a safe and strong session!',
  'All set! Keep showing up and staying fit!',
  "You're checked in! Great things start with showing up!",
  'Check-in successful! Sweat now, smile later!',
  'Welcome in! Have a productive workout!',
  "You're in! Every workout brings you closer to your goal!",
  'Check-in confirmed! Enjoy the burn!',
  'Checked in! Stay hydrated and train smart!',
  'All good! Have a rewarding session today!',
  "You're set! Let the gains begin!",
  'Check-in complete! Proud of you for showing up!',
  'Successfully checked in! Lift, move, and feel great!',
  "Welcome! Today's effort is tomorrow's strength!",
  "You're checked in! Have a superb workout!",
  "Check-in done! You've got this — enjoy every moment!",
];

const CHECKOUT_MESSAGES = [
  'Check-out complete! Great job today! 💪',
  "You're checked out! Well done on showing up!",
  'Session complete! You crushed it today!',
  'Check-out successful! Rest well and recover!',
  'You did it! See you next time!',
  'Checked out! Another workout in the bag!',
  'Great session! Take care and stay strong!',
  'Check-out done! You should be proud of yourself!',
  'Workout complete! Enjoy your well-deserved rest!',
  "You're all done! Amazing effort today!",
  'Checked out successfully! Keep the momentum going!',
  "Session over! Don't forget to stretch and hydrate!",
  'Check-out confirmed! You showed up and gave it your all!',
  'Well done! See you at your next session!',
  "You're checked out! Today's hard work will pay off!",
  'Great work! Rest up and come back stronger!',
  'Check-out complete! One more step toward your goal!',
  'Awesome session! Take care of yourself!',
  "Checked out! You earned that rest — enjoy it!",
  'Session done! Stay consistent and keep going!',
  'Check-out successful! Your body thanks you!',
  'Fantastic effort! See you soon!',
  "You're done! Another day of progress complete!",
  'Check-out confirmed! Recover well and stay motivated!',
  'Great hustle today! Rest and recharge!',
  'Checked out! You made today count!',
  'Workout wrapped up! Be proud of the effort!',
  "Check-out done! Keep showing up — it's working!",
  'Session complete! Stay hydrated and eat well!',
  "You're checked out! Every session makes you stronger!",
  'Well done today! Come back and do it again!',
  'Check-out complete! Hard work always pays off!',
  'Great job! Your future self will thank you!',
  'Checked out successfully! Rest is part of the journey!',
  'You crushed it! Enjoy the rest of your day!',
  'Check-out successful! Consistency is your superpower!',
  'Session over! Pat yourself on the back!',
  'All done! Great effort — see you next time!',
  'Check-out confirmed! Today was a win!',
  'Awesome workout! Take it easy and recover!',
  "You're checked out! Another goal-crushing session done!",
  "Workout complete! You're stronger than yesterday!",
  'Check-out done! Keep up the great work!',
  'Fantastic session! Rest well, champ!',
  "Checked out! You gave it your best — that's all that matters!",
  'Session wrapped up! Celebrate the effort!',
  'Check-out complete! See you next time, stronger!',
  "Great going! Don't skip your post-workout meal!",
  "You're all done! Today's sweat is tomorrow's strength!",
  'Check-out successful! Well done — you showed up and delivered!',
];

export type ConfirmKind = 'in' | 'out';

// One-shot handoff: a check-in/out screen sets it, then the home screen
// consumes it when it regains focus.
let pending: { kind: ConfirmKind; message: string } | null = null;

export function setPendingConfirmation(kind: ConfirmKind): void {
  const arr = kind === 'in' ? CHECKIN_MESSAGES : CHECKOUT_MESSAGES;
  const message = arr[Math.floor(Math.random() * arr.length)];
  pending = { kind, message };
}

export function consumePendingConfirmation(): { kind: ConfirmKind; message: string } | null {
  const p = pending;
  pending = null;
  return p;
}

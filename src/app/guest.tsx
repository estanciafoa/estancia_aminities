import AttendanceForm from '@/components/attendance-form';

export default function GuestScreen() {
  // Guests are never remembered and never subscription-checked.
  return <AttendanceForm category="Guest" enableHistory={false} />;
}

"use client";

import dynamic from "next/dynamic";
import type { Event } from "@/lib/events/types";

const EventForm = dynamic(() => import("./EventForm"), { ssr: false });

interface Props {
  event?: Event;
  isEdit?: boolean;
  fromReview?: boolean;
  googleMapsApiKey?: string | null;
}

export default function EventFormClient(props: Props) {
  return <EventForm {...props} />;
}

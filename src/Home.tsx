import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  ArrowLeftRight,
  MapPin,
  CalendarDays,
  Sparkles,
  ShieldCheck,
  Clock3,
  Radio,
  Leaf,
  ChevronRight,
} from "lucide-react";
import { cities, today, dateLabel } from "./lib";
import { useApp } from "./App";
export function SearchForm({
  initial = {},
}: {
  initial?: { from?: string; to?: string; date?: string };
}) {
  const [from, setFrom] = useState(initial.from ?? "Bengaluru"),
    [to, setTo] = useState(initial.to ?? "Chennai"),
    [date, setDate] = useState(initial.date ?? today());
  const nav = useNavigate();
  return (
    <form
      className="search-form"
      onSubmit={(e) => {
        e.preventDefault();
        nav(`/search?${new URLSearchParams({ from, to, date })}`);
      }}
    >
      <label>
        <MapPin />
        <span>
          <small>FROM</small>
          <select
            aria-label="Departure city"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          >
            {cities.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </span>
      </label>
      <button
        type="button"
        className="swap"
        aria-label="Swap departure and destination"
        onClick={() => {
          setFrom(to);
          setTo(from);
        }}
      >
        <ArrowLeftRight size={17} />
      </button>
      <label>
        <MapPin />
        <span>
          <small>TO</small>
          <select
            aria-label="Destination city"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          >
            {cities.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </span>
      </label>
      <label className="date-field">
        <CalendarDays />
        <span>
          <small>DEPARTURE</small>
          <input
            aria-label="Departure date"
            type="date"
            value={date}
            min={today()}
            required
            onChange={(e) => setDate(e.target.value)}
          />
        </span>
      </label>
      <button className="button button-orange" disabled={from === to}>
        Find my bus <ArrowRight size={19} />
      </button>
    </form>
  );
}
export default function Home() {
  const { openJarvis } = useApp();
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="online-dot" /> LESS PLANNING. MORE LIVING.
          </span>
          <h1>
            Somewhere good
            <br />
            is <em>waiting for you.</em>
          </h1>
          <p>
            The window seat. The open road. The people you’re going to meet.
            <br className="desktop" /> Let’s get you there, with a little more
            peace of mind.
          </p>
          <div className="hero-caption">
            <span className="mini-route" />
            <span>YOUR NEXT STORY STARTS HERE</span>
          </div>
        </div>
        <div
          className="hero-art"
          aria-label="Illustration of a green bus travelling through sunlit hills"
        >
          <div className="sun" />
          <div className="hill hill-back" />
          <div className="hill hill-front" />
          <div className="art-cloud cloud-one" />
          <div className="art-cloud cloud-two" />
          <div className="art-road" />
          <div className="road-mark" />
          <div className="bus-art">
            <div className="bus-top" />
            <div className="bus-windows">
              {Array.from({ length: 5 }, (_, i) => (
                <span key={i} />
              ))}
            </div>
            <div className="bus-stripe" />
            <span className="bus-art-name">HEAVEN—BUS</span>
            <div className="bus-door" />
            <div className="bus-light" />
            <div className="wheel wheel-one" />
            <div className="wheel wheel-two" />
          </div>
          <div className="floating-note">
            <span className="note-icon">
              <Leaf size={20} />
            </span>
            <div>
              A better way to go.
              <small>A little less rush. A lot more road.</small>
            </div>
          </div>
          <span className="art-coordinate">12.9716° N · 77.5946° E</span>
        </div>
      </section>
      <div className="home-search wrap">
        <SearchForm />
        <div className="search-reassurance">
          <span>
            <ShieldCheck size={15} />
            Your seat, safely held
          </span>
          <span>
            <Radio size={15} />
            Availability that’s actually live
          </span>
          <span>
            <Clock3 size={15} />5 minutes to make it yours
          </span>
        </div>
      </div>
      <section className="jarvis-banner wrap">
        <div className="jarvis-emblem">
          <Sparkles size={27} />
        </div>
        <div>
          <span className="eyebrow">MEET YOUR TRAVEL SIDEKICK</span>
          <h2>
            A plan in mind? <em>Just ask Jarvis.</em>
          </h2>
          <p>“Find me a bus to Chennai tomorrow, under ₹1,000.”</p>
        </div>
        <button className="button button-dark" onClick={() => openJarvis()}>
          Let’s talk travel <ArrowUpRight size={18} />
        </button>
        <div className="banner-decoration">✳</div>
      </section>
      <section className="destinations wrap">
        <div className="section-heading">
          <div>
            <span className="eyebrow">A CHANGE OF SCENERY</span>
            <h2>Where will the road take you?</h2>
          </div>
          <Link to="/search" className="text-link">
            Explore routes <ArrowUpRight size={17} />
          </Link>
        </div>
        <div className="destination-grid">
          {[
            {
              name: "Chennai",
              from: "Bengaluru",
              tag: "COASTAL DAYS. CITY NIGHTS.",
              art: "chennai",
              fare: "699",
              icon: "☀",
            },
            {
              name: "Goa",
              from: "Bengaluru",
              tag: "TAKE THE SCENIC ROUTE.",
              art: "goa",
              fare: "1,399",
              icon: "✳",
            },
            {
              name: "Hyderabad",
              from: "Bengaluru",
              tag: "OLD SOUL. NEW STORIES.",
              art: "hyderabad",
              fare: "1,099",
              icon: "◈",
            },
            {
              name: "Pune",
              from: "Mumbai",
              tag: "A LITTLE CLOSER TO THE HILLS.",
              art: "pune",
              fare: "449",
              icon: "△",
            },
          ].map((x) => (
            <Link
              to={`/search?from=${x.from}&to=${x.name}&date=${today()}`}
              className={`destination-card ${x.art}`}
              key={x.name}
            >
              <div className="destination-art">
                <span className="destination-symbol">{x.icon}</span>
                <div className="city-shape" />
                <span className="destination-tag">{x.tag}</span>
              </div>
              <div className="destination-info">
                <div>
                  <small>{x.from} to</small>
                  <h3>{x.name}</h3>
                  <p>Demo fares from ₹{x.fare}</p>
                </div>
                <span className="circle-arrow">
                  <ArrowUpRight size={20} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>
      <section className="promise wrap">
        <div>
          <span className="eyebrow">A LITTLE LESS WHAT IF</span>
          <h2>
            Your journey deserves
            <br />
            <em>a sure thing.</em>
          </h2>
          <p>
            We take care of the details, so you can look
            <br className="desktop" /> forward to what’s ahead.
          </p>
        </div>
        <div className="promise-features">
          <article>
            <Radio />
            <div>
              <h3>Live seats. No guessing.</h3>
              <p>See availability update as other travellers book.</p>
            </div>
          </article>
          <article>
            <Clock3 />
            <div>
              <h3>Take a breath. Your seat is held.</h3>
              <p>Five minutes to complete your booking, just for you.</p>
            </div>
          </article>
          <article>
            <ShieldCheck />
            <div>
              <h3>One seat. One traveller.</h3>
              <p>
                Database-protected bookings, with recovery if a payment arrives
                late.
              </p>
            </div>
          </article>
        </div>
      </section>
      <section className="closing wrap">
        <span className="eyebrow">THE BEST PART IS GETTING THERE</span>
        <h2>
          Pack a bag. Pick a seat. <em>Go.</em>
        </h2>
        <Link to="/search" className="button button-dark">
          Find your next journey <ArrowRight size={18} />
        </Link>
      </section>
    </>
  );
}

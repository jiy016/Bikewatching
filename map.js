// Set your Mapbox access token
mapboxgl.accessToken = "pk.eyJ1IjoiYm9ydWlsaW4iLCJhIjoiY203ZWZoZjJxMGQ0ZDJqb2cxOGRidjBkZiJ9.dJZ4b-RZgJL0Ck0Zpky5EQ"; // Replace with actual token

// Initialize the map
const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/streets-v12",
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18
});

map.on("load", async () => {
  console.log("Map is loaded");

  const bikeLaneStyle = {
    "line-color": "blue",
    "line-width": 5,
    "line-opacity": 0.5
  };

  map.addSource("boston_route", {
    type: "geojson",
    data: "https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson"
  });

  map.addLayer({
    id: "bike-lanes-boston",
    type: "line",
    source: "boston_route",
    paint: bikeLaneStyle
  });

  map.addSource("cambridge_route", {
    type: "geojson",
    data: "https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson"
  });

  map.addLayer({
    id: "bike-lanes-cambridge",
    type: "line",
    source: "cambridge_route",
    paint: bikeLaneStyle
  });

  console.log("Boston & Cambridge bike lanes added");

  const svg = d3.select("#map").select("svg");
  let stations = [];

  let departuresByMinute = Array.from({ length: 1440 }, () => []);
  let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

  const stationUrl = "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";
  const trafficUrl = "https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv";

  try {
    const stationData = await d3.json(stationUrl);
    stations = stationData.data.stations;
    console.log("Loaded Stations:", stations);

    let trips = await d3.csv(trafficUrl, trip => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);

      let startedMinutes = minutesSinceMidnight(trip.started_at);
      let endedMinutes = minutesSinceMidnight(trip.ended_at);

      departuresByMinute[startedMinutes].push(trip);
      arrivalsByMinute[endedMinutes].push(trip);

      return trip;
    });

    console.log("Loaded Traffic Data:", trips);

    function filterByMinute(tripsByMinute, minute) {
      if (minute === -1) return tripsByMinute.flat();

      let minMinute = (minute - 60 < 0) ? 1440 + (minute - 60) : (minute - 60);
      let maxMinute = (minute + 60) % 1440;

      if (minMinute > maxMinute) {
        return [...tripsByMinute.slice(minMinute), ...tripsByMinute.slice(0, maxMinute)].flat();
      } else {
        return tripsByMinute.slice(minMinute, maxMinute).flat();
      }
    }

    function computeStationTraffic(stations, timeFilter = -1) {
      const departures = d3.rollup(
        filterByMinute(departuresByMinute, timeFilter), // Efficient retrieval
        (v) => v.length,
        (d) => d.start_station_id
      );

      const arrivals = d3.rollup(
        filterByMinute(arrivalsByMinute, timeFilter), // Efficient retrieval
        (v) => v.length,
        (d) => d.end_station_id
      );

      return stations.map(station => ({
        ...station,
        departures: departures.get(station.short_name) ?? 0,
        arrivals: arrivals.get(station.short_name) ?? 0,
        totalTraffic: (departures.get(station.short_name) ?? 0) + (arrivals.get(station.short_name) ?? 0)
      }));
    }

    let stationFlow = d3.scaleQuantize()
      .domain([0, 1]) // Input: Ratio of departures to total traffic (0 to 1)
      .range([0, 0.5, 1]); // Output: Three discrete values representing arrivals, balanced, and departures

    stations = computeStationTraffic(stations);
    console.log("Updated Stations with Traffic Data:", stations);

    const radiusScale = d3
  .scaleSqrt()
  .domain([0, d3.max(stations, (d) => d.totalTraffic)])
  .range([1, 20]);

    function getCoords(station) {
      const point = new mapboxgl.LngLat(+station.lon, +station.lat);
      const { x, y } = map.project(point);
      return { cx: x, cy: y };
    }

    const circles = svg.selectAll("circle")
      .data(stations, d => d.short_name)
      .enter()
      .append("circle")
      .attr("fill", "steelblue")
      .attr("stroke", "white")
      .attr("stroke-width", 1)
      .attr("opacity", 0.8)
      .attr("pointer-events", "auto")
      .attr("r", d => radiusScale(d.totalTraffic))
      .attr("cx", d => getCoords(d).cx)
      .attr("cy", d => getCoords(d).cy)
      .style("--departure-ratio", d => stationFlow(d.departures / d.totalTraffic))
      .on("mouseover", (event, d) => {
        let stationName = d.NAME || d.name || d.short_name || "Unknown Station"; // Check different possible names
    
        d3.select("#tooltip")
          .style("visibility", "visible")
          .html(`<strong>${stationName}</strong><br>🚲 Total: ${d.totalTraffic}<br>⬆ Departures: ${d.departures}<br>⬇ Arrivals: ${d.arrivals}`)
          .style("left", event.pageX + "px")
          .style("top", event.pageY - 30 + "px");
    })
    
      .on("mouseout", () => {
        d3.select("#tooltip").style("visibility", "hidden");
      });

    function updatePositions() {
      circles.attr("cx", d => getCoords(d).cx)
        .attr("cy", d => getCoords(d).cy);
    }

    updatePositions();
    map.on("move", updatePositions);
    map.on("zoom", updatePositions);
    map.on("resize", updatePositions);
    map.on("moveend", updatePositions);

    const timeSlider = document.getElementById("time-slider");
    const selectedTime = document.getElementById("selected-time");
    const anyTimeLabel = document.getElementById("any-time");

    function formatTime(minutes) {
      const date = new Date(0, 0, 0, 0, minutes);
      return date.toLocaleString("en-US", { timeStyle: "short" });
    }

    function minutesSinceMidnight(date) {
      return date.getHours() * 60 + date.getMinutes();
    }
    
    function updateScatterPlot(timeFilter) {
      const filteredStations = computeStationTraffic(stations, timeFilter);
  
      radiusScale.range(timeFilter === -1 ? [1, 10] : [1, 25]); // Adjust these values
  
      radiusScale.domain([0, d3.max(filteredStations, d => d.totalTraffic)]);
  
      let updatedCircles = circles.data(filteredStations, d => d.short_name);
  
      updatedCircles
          .enter()
          .append("circle")
          .merge(updatedCircles)
          .attr("r", d => radiusScale(d.totalTraffic))
          .style("--departure-ratio", d => {
              let ratio = d.totalTraffic > 0 ? d.departures / d.totalTraffic : 0.5;
              return stationFlow(ratio);
          });
  }
  
  
    

    function updateTimeDisplay() {
      let timeFilter = Number(timeSlider.value);
      selectedTime.textContent = timeFilter === -1 ? "" : formatTime(timeFilter);
      anyTimeLabel.style.display = timeFilter === -1 ? "block" : "none";
      updateScatterPlot(timeFilter);
    }

    timeSlider.addEventListener("input", () => {
        let timeFilter = Number(timeSlider.value);
        updateTimeDisplay();
        updateScatterPlot(timeFilter); // Ensures updates happen live
    });

  } catch (error) {
    console.error("Error loading data:", error);
  }
});

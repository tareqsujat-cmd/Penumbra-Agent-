/** References for the research report (verified entries from the team's report; numbered in order of first citation
 *  by the report component). */
export interface Ref {
  key: string;
  text: string;
  url?: string;
}

export const REFS: Ref[] = [
  { key: "lpsc9", text: "George, Rubio, Lawrence and Curell (NASA; Booz Allen Hamilton) (2026). Artemis III site selection update. 57th Lunar and Planetary Science Conference, abstract 1901.", url: "https://www.hou.usra.edu/meetings/lpsc2026/pdf/1901.pdf" },
  { key: "athena", text: "NASA (March 2025). NASA Receives Some Data Before Intuitive Machines Ends Lunar Mission (IM-2 Athena); and LROC, Arizona State University, images 1401 and 1408 (Athena target and at rest).", url: "https://www.nasa.gov/news-release/nasa-receives-some-data-before-intuitive-machines-ends-lunar-mission/" },
  { key: "moonbase", text: "NASA. CLPS Flight: Blue Origin's Blue Moon Mark 1 (Moon Base I; Shackleton Connecting Ridge).", url: "https://www.nasa.gov/event/clps-flight-blue-origins-blue-moon-mark-1/" },
  { key: "barker", text: "Barker, M. K., et al. (2021). Improved LOLA elevation maps for south pole landing sites: error estimates and their impact on illumination conditions. Planetary and Space Science 203, 105119. Data: NASA GSFC PGDA product 78.", url: "https://doi.org/10.1016/j.pss.2020.105119" },
  { key: "mazarico", text: "Mazarico, E., et al. (2011). Illumination conditions of the lunar polar regions using LOLA topography. Icarus 211, 1066–1081. Data: NASA GSFC PGDA product 69.", url: "https://doi.org/10.1016/j.icarus.2010.10.030" },
  { key: "glaser", text: "Gläser, P., et al. (2018). Illumination conditions at the lunar poles: implications for future exploration. Planetary and Space Science 162, 170–178.", url: "https://ntrs.nasa.gov/api/citations/20170007365/downloads/20170007365.pdf" },
  { key: "lmap", text: "Skinner, J. A., et al. (USGS, GSFC, JPL and others) (2026). The Lunar Mapping Program (LMAP). 57th Lunar and Planetary Science Conference, abstract 1910.", url: "https://www.hou.usra.edu/meetings/lpsc2026/pdf/1910.pdf" },
  { key: "lola", text: "NASA LRO Lunar Orbiter Laser Altimeter (LOLA). Gridded south-polar elevation maps LDEM_80S_80M and LDEM_75S_240M. PDS Geosciences Node.", url: "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/" },
  { key: "spice", text: "Acton, C. H. (1996). Ancillary data services of NASA's Navigation and Ancillary Information Facility. Planetary and Space Science 44(1), 65–70; NASA NAIF SPICE Toolkit and generic kernels (DE440).", url: "https://naif.jpl.nasa.gov/naif/" },
  { key: "horizons", text: "NASA JPL Solar System Dynamics. Horizons System (topocentric Sun and Earth positions).", url: "https://ssd.jpl.nasa.gov/horizons/" },
  { key: "dsn", text: "NASA JPL Deep Space Network. DSN Telecommunications Link Design Handbook 810-005, Module 301, Rev. P (station coordinates and elevation masks).", url: "https://deepspace.jpl.nasa.gov/dsndocs/810-005/301/301P.pdf" },
  { key: "viper", text: "NASA VIPER: LSIC 2024 Tech Infusion panel, VIPER mobility and hardware (5,420 Wh; 320 W per panel; 50 h survival), NTRS 20240013903; and the VIPER Program Information Package.", url: "https://ntrs.nasa.gov/api/citations/20240013903/downloads/LSIC_2024-Tech%20Infusion_Panel-VIPER_Mob-HW.pdf" },
  { key: "databook", text: "NASA (2023). Lunar Surface Data Book, NTRS 20230007818 (candidate sites, including the Malapert massif).", url: "https://ntrs.nasa.gov/citations/20230007818" },
  { key: "bsc", text: "Hoffleit, D. and Warren, W. H. (1991). The Bright Star Catalogue, 5th revised edition. CDS VizieR catalogue V/50.", url: "https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=V/50" },
  { key: "challenge", text: "NASA Space Apps Challenge 2026. CLPS Lunar Mission Browser (challenge page).", url: "https://www.spaceappschallenge.org/2026/challenges/clps-lunar-mission-browser/" },
];

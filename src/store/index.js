import Vue from 'vue'
import Vuex from 'vuex'
import * as d3 from 'd3'
import _ from 'lodash'
import p5 from 'p5'
import {apiService} from '../firebase/db'
import {v4 as uuidv4} from 'uuid'
import i18n from '../i18n'

Vue.use(Vuex)

import diseaseNumbers from '../assets/diseaseNumbers.json'
import numTimesOut from '../assets/numTimesOut.json'

let allPastGames = []
let populationsByZip = []
let hospitalsByZip = []
let citiesByZip = []
let prevInfected = []
let dailyHealthStatus = []
const totalPlayers = 20
const numPastPlayers = totalPlayers - 1
const foodStatus = {value: 18, maxValue: 18}
const exerciseStatus = {value: 31, maxValue: 31}
const usualActivityLevel = [3, 5, 2, 1, 5] // food, exercise, small, large, work
const bestActivityLevel = [1, 3, 0, 0, 0]

function assignHealth(person, daysSinceInfection, prevInHospital) {
  // health statuses: 0 = healthy, 1 = recovered, 2 = infected+asymptomatic,
  // 3 = infected+ symptomatic, 4 = hospitalized from infection, 5 = died from infection
  // Option to add additional for infected+presymptomatic; and/or to include infectious here rather than as a separate variable
  let newHealth = 0
  let newInfectious = 0
  if (daysSinceInfection >= 14) {
    const dies = prevInHospital
      ? person.dieIfHospitalized
      : person.dieIfNotHospitalized
    newHealth = dies ? 5 : 1 // dead or recovered
    newInfectious = 0
  } else if (daysSinceInfection >= 7 && person.hospitalIfSymptomatic) {
    newHealth = 4 // hospitalized
    newInfectious = 1
  } else if (daysSinceInfection >= 6) {
    newHealth = person.symptomaticIfInfected ? 3 : 2 // symptomatic or asymptomatic
    newInfectious = 1 // and infectious
  } else if (daysSinceInfection >= 4) {
    newHealth = 2 // asymptomatic
    newInfectious = 1 // and infectious
  } else if (daysSinceInfection > 0) {
    newHealth = 2 // asymptomatic
    newInfectious = 0 // and not infectious
  }
  return {health: newHealth, infectious: newInfectious}
}

function healthAndDestination(
  person,
  houses,
  daysSinceInfection,
  prevInfectious,
  prevInHospital,
  decisions,
  infectedDestinations,
  infectedHouses,
) {
  const {health, infectious} = assignHealth(
    person,
    daysSinceInfection,
    prevInHospital,
  )

  let destination = -1 // default to home
  if ((health < 3 || (health === 3 && Math.random() > 0.5))) {
    // if they're healthy, recovered, or asymptomatic
    // or if they're mild symptom they have 50% (made up) likelihood of going out
    let {destinations} = houses[person.houseIndex]
    _.each(decisions, (goOut, activity) => {
      // if decided not to go out for the activity
      // or the activity is work but they're unemployed
      if (!goOut || (activity === 4 && !person.work)) return
      if (activity === 3) { // if large gathering
        destinations = _.sampleSize(destinations, _.random(1, 5))
        destination = _.sample(destinations)
      } else {
        if (activity === 4) { // if work
          destination = person.work
        } else {
          destination = _.sample(destinations)
        }
        destinations = [destination]
      }

      _.each(destinations, destination => {
        // then go
        if (infectious) {
          // but if they're asymptomatic, add that as infected destination
          infectedDestinations[destination] =
            (infectedDestinations[destination] || 0) + (activity === 1 ? 0.1 : 1)
        }
      })
    })
  }

  // and if they were infectious the previous day
  // (want previous day bc they'd have spent a night in same house)
  // add their house as infectious also
  if (prevInfectious) {
    infectedHouses[person.houseIndex] =
      (infectedHouses[person.houseIndex] || 0) + 2
  }

  return {health, infectious, destination}
}

function infectPerson(
  obj,
  house,
  destination,
  susceptibility,
  infectedDestinations,
  infectedHouses,
) {
  const timesExposed =
    (infectedDestinations[destination] || 0) + (infectedHouses[house] || 0)
  // if didn't get exposed, don't need to update
  if (!timesExposed) return
  // ( 1 - ( ( 1 - susceptibility ) ^ number of exposures ) ) > random number from 0-1
  const infected =
    1 - Math.pow(1 - susceptibility, timesExposed) > Math.random()
  if (!infected) return

  Object.assign(obj, {
    daysSinceInfection: 1,
    health: 2,
    infectious: 0, // newly infected, so asymptomatic & not infectious
  })
}

export default new Vuex.Store({
  state: {
    currentPage: 'landing',
    day: 0,
    zipCode: '',
    dataLoaded: false,
    gamesLoaded: false,
    bedOccupancyRate: 0.66,
    totalDays: 8 * 7,
    foodStatus: {},
    exerciseStatus: {},
    country: '',
    gameId: '',
    createdAt: '',
    communitySize: '',
    teamName: '',
    teamNames: [],
    decisions: [usualActivityLevel],
  },
  getters: {
    week({day}) {
      return Math.ceil(day / 7)
    },
    sampledPastGames({gamesLoaded}) {
      if (!gamesLoaded) return
      return _.sampleSize(allPastGames, numPastPlayers)
    },
    otherDecisions(state, {sampledPastGames}) {
      if (!sampledPastGames) return
      const allDecisions = _.map(sampledPastGames, 'decisions')
      // if there still aren't enough, then add in the rest assuming they go out every day
      _.times(numPastPlayers - allDecisions.length, i => {
        const decisions = []
        _.times(8, i => {
          const decision = _.map(usualActivityLevel, d => {
            return _.chain(p5.prototype.randomGaussian(d, 1))
              .round()
              .clamp(0, 7)
              .value()
          })
          decisions.push(decision)
        })
        allDecisions.push(decisions)
      })
      return allDecisions
    },
    allDecisions({decisions}, {otherDecisions}) {
      if (!otherDecisions) return
      return _.concat([decisions], otherDecisions)
    },
    pastPlayerIDs(state, {sampledPastGames}) {
      return _.map(sampledPastGames, 'id')
    },
    allZips({dataLoaded}) {
      if (!dataLoaded) return
      return _.map(populationsByZip, d => d.zip)
    },
    zipsByCommunitySize({dataLoaded}) {
      if (!dataLoaded) return
      return _.groupBy(populationsByZip, d => {
        if (d.total > 50000) return 'urban'
        if (d.total > 10000) return 'suburban'
        if (d.total > 5000) return 'rural'
        return 'others'
      })
    },
    population({zipCode, dataLoaded}) {
      if (!zipCode || !dataLoaded) return
      return _.find(populationsByZip, d => d.zip === zipCode)
    },
    cityCounty({zipCode, dataLoaded}) {
      if (!zipCode || !dataLoaded) return
      return _.find(citiesByZip, d => d.zip === zipCode)
    },
    zipsInCounty(state, {cityCounty}) {
      if (!cityCounty) return
      return _.chain(citiesByZip)
        .filter(d => d.county === cityCounty.county)
        .map('zip')
        .value()
    },
    hospitals(state, {zipsInCounty}) {
      if (!zipsInCounty) return
      return _.filter(hospitalsByZip, d => _.includes(zipsInCounty, d.zip))
    },
    totalBeds(state, {hospitals, population, zipsInCounty, cityCounty}) {
      if (!population || !hospitals || !zipsInCounty || !cityCounty) return
      let countyPopulation
      let totalCountyBeds
      if (hospitalsByZip[0].zip) {
        // if hospitals are based on zips
        countyPopulation = _.sumBy(populationsByZip, d =>
          _.includes(zipsInCounty, d.zip) ? d.total : 0,
        )
        totalCountyBeds = _.sumBy(hospitals, d => (d.beds > 0 ? d.beds : 0))
      } else {
        // else based on county
        const hospitalCounty = _.find(hospitalsByZip, ({county}) => county === cityCounty.county)
        countyPopulation = hospitalCounty.population
        totalCountyBeds = hospitalCounty.beds
      }
      return Math.floor(population.total * (totalCountyBeds / countyPopulation))
    },
    totalAvailableBeds({bedOccupancyRate}, {totalBeds}) {
      if (!totalBeds) return
      return Math.floor((1 - bedOccupancyRate) * totalBeds)
    },
    filledBeds(state, {infected, totalAvailableBeds}) {
      if (!infected || !totalAvailableBeds) return
      return Math.min(
        _.sumBy(infected, ({health}) => health === 4), // hospitalized
        totalAvailableBeds,
      )
    },
    community(state, {population}) {
      if (!population) return

      const totalPopulation = population.total

      // make 100 establishments per 1000 people
      // and 7 destinations per group
      const destPerGroup = 7
      const numDestinations = _.floor(0.05 * totalPopulation) || 1
      const numDestGroups = Math.ceil(numDestinations / destPerGroup)
      const destinations = _.times(numDestinations, i => {
        return {
          id: `dest${i}`,
          groupIndex: Math.floor(i / destPerGroup),
        }
      })

      const ageGroups = _.map(['0', '20', '40', '60', '80'], (key, i) => {
        return [i * 20, population[key], key]
      })
      // go through, create people, and assign each person to a house
      const people = []
      const houses = []
      let personIndex = 0
      let houseIndex = 0
      while (personIndex < totalPopulation) {
        // randomly assign number of people to a house
        // between 2 and 5 people
        let numPeopleInHouse = _.random(1, 5)
        // make sure it doesn't go over total population
        if (personIndex + numPeopleInHouse > totalPopulation) {
          numPeopleInHouse = totalPopulation - personIndex
        }

        const house = {
          id: `house${houseIndex}`,
          numPeople: numPeopleInHouse,
          people: [],
        }
        houses.push(house)

        // for each person in house, create object
        _.times(numPeopleInHouse, i => {
          // calculate person's age
          let age
          let ageGroup
          while (true) {
            const index = _.random(ageGroups.length - 1)
            const [baseAge, remaining, key] = ageGroups[index]
            if (remaining > 0) {
              age = _.random(baseAge, baseAge + 19)
              ageGroup = key
              ageGroups[index][1] = remaining - 1
              break
            }
          }

          // set susceptibility and other numbers based on their age group
          let {
            susceptibility,
            symptomaticIfInfected,
            hospitalIfSymptomatic,
            dieIfHospitalized,
            dieIfNotHospitalized,
            employed,
          } = diseaseNumbers['ageGroups'][ageGroup]
          symptomaticIfInfected = +(Math.random() < symptomaticIfInfected)
          hospitalIfSymptomatic = +(
            symptomaticIfInfected && Math.random() < hospitalIfSymptomatic
          )
          dieIfHospitalized = +(
            hospitalIfSymptomatic && Math.random() < dieIfHospitalized
          )
          dieIfNotHospitalized = +(
            hospitalIfSymptomatic && Math.random() < dieIfNotHospitalized
          )

          people.push({
            index: personIndex + i,
            id: `person${personIndex + i}`,
            houseIndex, // reference house person lives in
            age,
            ageGroup,
            susceptibility,
            symptomaticIfInfected,
            hospitalIfSymptomatic,
            dieIfHospitalized,
            dieIfNotHospitalized,
            work: Math.random() < employed,
          })
          house.people.push(personIndex + i)
        })

        personIndex += numPeopleInHouse
        houseIndex += 1
      }

      // assign houses and destinations to each other
      const housesPerGroup = Math.ceil(houses.length / numDestGroups)
      _.times(numDestGroups, groupIndex => {
        const housesIndicesInGroup = _.range(
          groupIndex * housesPerGroup,
          (groupIndex + 1) * housesPerGroup,
        )
        const destIndicesInGroup = _.union(
          _.range(groupIndex * destPerGroup, (groupIndex + 1) * destPerGroup),
          _.times(5, i =>
            _.random(
              (groupIndex + 2) * destPerGroup,
              (groupIndex + 4) * destPerGroup,
            ),
          ),
        )
        _.each(housesIndicesInGroup, i => {
          if (!houses[i]) return
          // update house with destinations
          Object.assign(houses[i], {
            groupIndex,
            destinations: destIndicesInGroup,
          })
          // update people's work
          _.each(houses[i].people, i => {
            Object.assign(people[i], {
              work: people[i].work && _.sample(destIndicesInGroup),
            })
          })
        })
      })

      return {people, houses, destinations, numGroups: numDestGroups}
    },
    infected(
      {day, totalDays},
      {week, allDecisions, community, totalAvailableBeds},
    ) {
      if (day < 1 || !community || !allDecisions) return
      // and if this is the same day as previous, then don't do anything
      const prevDailyHealth = _.last(dailyHealthStatus)
      if (prevDailyHealth && prevDailyHealth.day === day) return

      const {people, houses} = community

      if (!prevInfected.length) {
        // if this is the first day, seed infections
        prevInfected = _.map(people, (person, i) => {
          // And then assign days for those randomly between 1 and 6.
          // We'll probably want to change this, but it gives us something to work with.
          let daysSinceInfection = i % 1000 ? 0 : _.random(1, 4)
          let {health, infectious} = assignHealth(person, daysSinceInfection)

          return {
            index: i,
            daysSinceInfection,
            health,
            infectious,
            worstAlternate: {health, infectious, daysSinceInfection},
          }
        })
      }

      const infectedHouses = []
      const infectedDestinations = []
      const worstAlternateHouses = [] // same as infectedHouses, but for worstAlternate scenario
      const worstAlternateDestinations = []
      let numSevere = 0
      let numWorstAlternateSevere = 0
      let numBestAlternateSevere = 0
      const infected = _.map(people, (person, i) => {
        let {
          health: prevHealth,
          infectious: prevInfectious,
          inHospital: prevInHospital,
          daysSinceInfection,
          worstAlternate: prevWorstAlternate,
          weeklyDecision,
        } = prevInfected[i]

        const dayOfWeek = (day - 1) % 7
        // if this is first day of week
        // figure out number of times to go out
        if (dayOfWeek === 0) {
          // either use that week's decisions or if past week 8
          // (and thus decisions is undefined) use usual activity level
          const decisions = allDecisions[i % totalPlayers][week - 1] || usualActivityLevel
          const player = _.map(decisions, (numTimes, activity) => {
            if (numTimes === 7 || numTimes === 0) return numTimesOut[numTimes][0]
            return _.sample(numTimesOut[numTimes])
          })
          const worstAlternate = _.map(decisions, (numTimes, activity) => {
            numTimes = usualActivityLevel[activity]
            if (numTimes === 7 || numTimes === 0) return numTimesOut[numTimes][0]
            return _.sample(numTimesOut[numTimes])
          })
          weeklyDecision = {
            player,
            worstAlternate,
          }
        }

        // calculate everyone's new health/infectiousness for current day
        daysSinceInfection += !!daysSinceInfection // if days = 0, don't add any, if >0 then add 1
        const {health, infectious, destination} = healthAndDestination(
          person,
          houses,
          daysSinceInfection,
          prevInfectious,
          prevInHospital,
          _.map(weeklyDecision.player, decisions => decisions[dayOfWeek]),
          infectedDestinations,
          infectedHouses,
        )
        let inHospital = prevInHospital
        if (health === 4) {
          // if the person is in severe condition
          numSevere += 1
          inHospital = numSevere <= totalAvailableBeds
        }

        // now calculate for an worstAlternate scenario
        prevWorstAlternate.daysSinceInfection += !!prevWorstAlternate.daysSinceInfection
        const worstAlternate = Object.assign(
          healthAndDestination(
            person,
            houses,
            prevWorstAlternate.daysSinceInfection,
            prevWorstAlternate.infectious,
            prevWorstAlternate.inHospital,
            _.map(weeklyDecision.worstAlternate, decisions => decisions[dayOfWeek]),
            worstAlternateDestinations,
            worstAlternateHouses,
          ),
          {daysSinceInfection: prevWorstAlternate.daysSinceInfection},
        )
        if (worstAlternate.health === 4) {
          numWorstAlternateSevere += 1
          worstAlternate.inHospital =
            numWorstAlternateSevere <= totalAvailableBeds
        }

        return {
          index: i,
          house: person.houseIndex,
          daysSinceInfection,
          health,
          infectious,
          destination,
          inHospital,
          worstAlternate,
          weeklyDecision,
        }
      })

      // for each healthy person
      _.each(infected, person => {
        const {house, destination, index} = person
        if (person.health === 0) {
          // if they're healthy in current game, calculate whether they get infected
          infectPerson(
            person,
            house,
            destination,
            people[index].susceptibility,
            infectedDestinations,
            infectedHouses,
          )
        }
        if (person.worstAlternate.health === 0) {
          // if in worstAlternate simulation they're healthy
          // calculate whether they get infected there
          infectPerson(
            person.worstAlternate,
            house,
            person.worstAlternate.destination,
            people[index].susceptibility,
            worstAlternateDestinations,
            worstAlternateHouses,
          )
        }
      })

      prevInfected = infected

      return infected
    },
    dailyHealthStatus({day}, {infected}) {
      if (!infected) return
      // keeps track of all cumulative numbers for every scenario daily
      const status = {day}
      const types = ['player', 'worstAlternate']
      const totalHealthStatus = [1, 2, 3, 4, 5]
      _.each(infected, d => {
        _.each(types, type => {
          if (!status[type]) {
            status[type] = {total: 0, infectious: 0}
          }

          const infectious =
            type === 'player' ? d.infectious : d[type].infectious
          if (infectious) {
            status[type].infectious += 1
          }

          const health = type === 'player' ? d.health : d[type].health
          if (!status[type][health]) {
            status[type][health] = 0
          }
          status[type][health] += 1

          if (_.includes(totalHealthStatus, health)) {
            status[type].total += 1
          }
        })
      })

      dailyHealthStatus.push(status)
      return dailyHealthStatus
    },
  },
  mutations: {
    setCurrentPage(state, currentPage) {
      state.currentPage = currentPage
    },
    setDataLoaded(state, dataLoaded) {
      state.dataLoaded = dataLoaded
    },
    setGamesLoaded(state, gamesLoaded) {
      state.gamesLoaded = gamesLoaded
    },
    setDay(state, day) {
      state.day = day
      // if player decides to look at 4 more weeks of simulation
      // then don't do anything more to the food & exercise
      if (day > state.totalDays) return

      // for every day they don't get groceries
      state.foodStatus.value = Math.max(0, state.foodStatus.value - 1)
      state.exerciseStatus.value = Math.max(0, state.exerciseStatus.value - 1)
      if (state.foodStatus.value === 0 || state.exerciseStatus.value === 0) {
        state.currentPage = 'failed'
      }
    },
    setZipCode(state, zipCode) {
      state.zipCode = '' + zipCode // stringify just in case
    },
    setCommunitySize(state, communitySize) {
      state.communitySize = communitySize
    },
    setDecisions(state, decisions) {
      const [food, exercise] = decisions
      if (food) {
        // if they go out twice, 2 weeks of groceries are taken care of
        state.foodStatus.value = Math.min(
          state.foodStatus.value + 4 * food,
          state.foodStatus.maxValue,
        )
      }
      if (exercise) {
        // if go out more than once, then they did exercise
        state.exerciseStatus.value = Math.min(
          state.exerciseStatus.value + 2 * exercise,
          state.exerciseStatus.maxValue,
        )
      }
      state.decisions.push(decisions) // update decisions for current player
    },
    setFoodStatus(state, foodStatus) {
      state.foodStatus = _.clone(foodStatus)
    },
    setExerciseStatus(state, exerciseStatus) {
      state.exerciseStatus = _.clone(exerciseStatus)
    },
    setGameIdAndCreatedAt(state) {
      state.gameId = uuidv4()
      state.createdAt = new Date()
    },
    setCountry(state) {
      const country = (navigator.language || navigator.userLanguage).split('-')[1]
      // if no country found, just default to US
      state.country = country ? country.toLowerCase() : 'us'
    },
    setTeamName(state, teamName) {
      state.teamName = teamName
    },
    setTeamNames(state, teamNames) {
      state.teamNames = teamNames
    },
  },
  actions: {
    getRawData({commit, state, dispatch}) {
      function formatData(obj) {
        let zip = obj.zip // make sure zip doesn't get turned into integers
        if (zip && zip.length === 3) {
          zip = '00' + zip
        }
        if (zip && zip.length === 4) {
          zip = '0' + zip
        }
        return Object.assign(d3.autoType(obj), {
          [zip ? 'zip' : 'county']: zip || obj.county,
        }) // but everything else is formatted correctly
      }
      Promise.all([
        d3.csv(`/${state.country}/population-by-zip-code.csv`, formatData),
        d3.csv(`/${state.country}/hospitals-by-zip-code.csv`, formatData),
        d3.csv(`/${state.country}/zip-to-city-county.csv`, formatData),
      ]).then(([populations, hospitals, cities]) => {
        populationsByZip = populations
        hospitalsByZip = hospitals
        citiesByZip = cities

        commit('setDataLoaded', true)
        commit('setFoodStatus', foodStatus)
        commit('setExerciseStatus', exerciseStatus)
      })
    },
    getAllTeamNames({commit}) {
      apiService.getTeamNames({
        cb: teamNames => {
          commit('setTeamNames', teamNames)
        },
      })
    },
    getPastGames({commit, dispatch}) {
      // first, see if there's a team name
      const url = document.URL.toLowerCase()
      let teamName = null
      if (_.includes(url, 'team')) {
        teamName = _.trim(url.split('/team/')[1])
      }

      apiService.getFilteredGamesWithDefault({
        filters: {teamName},
        cb: data => {
          allPastGames = _.map(data, ({id, teamName, decisions}) => {
            return {
              id, teamName,
              decisions: JSON.parse(decisions),
            }
          })

          commit('setGamesLoaded', true)
          commit('setTeamName', data[0].teamName)
        },
      })
    },
    storeGame({
      state: {
        zipCode,
        gameId,
        communitySize,
        createdAt,
        country,
        teamName,
      },
      getters: {
        allDecisions,
        pastPlayerIDs,
      },
    }) {
      apiService.setGameById(gameId, {
        id: gameId,
        // don't get dailyHealthStatus from getter, which will trigger
        // it (and thus `infected` that it relies on) to recalculate
        // instead, use the global variable which give the same thing back
        dailyHealthStatus,
        // stringify for the database
        decisions: JSON.stringify(allDecisions[0] || []),
        // use this in db to filter by those that have gone through all 8 weeks
        numDecisions: (allDecisions[0] || []).length,
        pastPlayerIDs,
        zipCode,
        communitySize,
        createdAt,
        country,
        teamName,
      })
    },
    resetGame({commit, state}) {
      // reset prevInfected
      prevInfected = []
      dailyHealthStatus = []

      const {sampledPlayers, allDecisions} = samplePastGames()
      commit('setAllDecisions', allDecisions)
      commit('setPastPlayerIDs', _.map(sampledPlayers, 'id'))
      commit('setTeamName', sampledPlayers[0].teamName)

      commit('setDay', 0)
      commit('setFoodStatus', foodStatus)
      commit('setExerciseStatus', exerciseStatus)
      commit('setCurrentPage', 'landing')
    },
  },
})

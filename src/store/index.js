import Vue from 'vue'
import Vuex from 'vuex'
import * as d3 from 'd3'
import _ from 'lodash'

Vue.use(Vuex)

export default new Vuex.Store({
  state: {
    day: 0,
    zipCode: '',
    numBeds: 0,
    dataLoaded: false,
  },
  getters: {
  },
  mutations: {
    setDay(state, day) {
      state.day = day
    },
    setZipCode(state, zipCode) {
      state.zipCode = zipCode
    },
    setDataLoaded(state, dataLoaded) {
      state.dataLoaded = dataLoaded
    },
  },
  actions: {
    getRawData({commit, state}) {
      function formatData(obj) {
        const zip = obj.zip // make sure zip doesn't get turned into integers
        return Object.assign(d3.autoType(obj), {zip}) // but everything else is formatted correctly
      }
      Promise.all([
        d3.csv('./population-by-zip-code.csv', formatData),
        d3.csv('./hospitals-by-zip-code.csv', formatData),
      ]).then(([populations, hospitals]) => {
        this.populations = populations
        this.hospitals = hospitals

        commit('setDataLoaded', true)
      })
    },
    setup ({ commit }) {
      // for now, assume population size
      const totalPopulation = 50000

      // 2.8 beds for every 1000
      const numBeds = _.round(0.0028 * totalPopulation)

      // ~184 bars&restaurants for 1000 people in America (need to source this)
      const numDestinations = _.floor(0.05 * totalPopulation) || 1
      const destinations = _.times(numDestinations, i => {
        return {
          id: `dest${i}`,
          houses: [], // houses whose people visit that establishment
        }
      })

      // go through and assign each person to a house
      const people = []
      const houses = []
      let personIndex = 0
      let houseIndex = 0
      while(personIndex < totalPopulation) {
        // randomly assign number of people to a house
        // between 1 and 4 people
        let numPeopleInHouse = _.random(1, 4)
        // make sure it doesn't go over total population
        if (personIndex + numPeopleInHouse > totalPopulation) {
          numPeopleInHouse = totalPopulation - personIndex
        }

        const house = {
          id: `house${houseIndex}`,
        }
        houses.push(house)

        // for each person in house, create object
        _.times(numPeopleInHouse, i => {
          people.push({
            id: `person${personIndex + i}`,
            houseIndex, // reference house person lives in
            destination: 0, // index of establishment or 0 if stay at home?
            age: 0, // TODO: UPDATE
            health: 0,
            susceptibility: 0, // TODO: UPDATE
            daysSinceInfection: 0,
          })
        })

        personIndex += numPeopleInHouse
        houseIndex += 1
      }

      const destHouseRatio = destinations.length / houses.length
      _.each(houses, (house, i) => {
        const start = _.floor(i * destHouseRatio)
        house.destinations = _.chain(_.random(5, 10))
          // randomly assign 5 - 10 destinations to this house
          .times(num => _.random(start, start + 20))
          // but make sure we don't get the same destinations more than once
          .uniq()
          // and make sure the destination exists
          .filter(dest => destinations[dest])
          .value()

        // and likewise register that house to its destinations
        _.each(house.destinations, index => destinations[index].houses.push(houseIndex))
      })

      // set all new numbers
      commit('setPeople', people)
      commit('setHouses', houses)
      commit('setDestinations', destinations)
      commit('setNumBeds', numBeds)
    },
    updateDecision ({ commit, state }, decision) {
      const {day, people, houses, destinations, numBeds} = state
      // TODO: FILL WITH ACTUAL SIMULATION
      _.each(people, person => {
        const dests = [0]
        _.each(houses[person.houseIndex].destinations, dest => dests.push(dest + 1))
        return Object.assign(person, {
          health: _.random(2),
          destination: dests[_.random(dests.length - 1)]
        })
      })

      _.times(_.random(numBeds), i => people[_.random(people.length - 1)].health = 3)

      commit('setDay', day + 1)
    },
  }
})

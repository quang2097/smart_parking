#include "traffic/Simulation.hpp"
#include "traffic/Geometry.hpp"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <unordered_map>
using namespace traffic;
int main(int argc,char** argv) {
    std::cout<<std::unitbuf;
    try {
        if(argc!=5) throw std::runtime_error("Expected mask, seed, spawn rate, spawn duration");
        unsigned seed=static_cast<unsigned>(std::stoul(argv[2]));
        double rate=std::stod(argv[3]),duration=std::stod(argv[4]);
        Simulation s(Map::fromPng(argv[1],.5),seed);
        // This regression measures physical recovery without deleting traffic.
        s.setStuckVehicleSettings({false,30}); s.setTrafficRecoverySettings({false,1});
        s.setTrafficLights({{{30,22},{30,38},10,2,12,0,true}});
        constexpr double dt=1.0/120;
        double spawnClock=0; unsigned admitted=0;
        std::unordered_map<std::uint64_t,Vec2> previous;
        std::unordered_map<std::uint64_t,Vec2> progressAnchors;
        double lastFleetProgress=0;
        auto start=std::chrono::steady_clock::now();
        // Curved maneuvers reserve more space than pivots and can take longer
        // to drain under pressure. Still require every vehicle to arrive, and
        // catch sustained physical standstills independently of that deadline.
        for(int step=0;step<static_cast<int>((duration+300)/dt);++step) {
            if(step*dt<duration) {
                spawnClock+=dt;
                if(spawnClock>=1/rate) { spawnClock=0; if(s.spawnRandom(3)) ++admitted; }
            }
            s.tick(dt);
            if(step%3600==0) std::cout<<"t="<<s.seconds()<<" active="<<s.entities().size()<<" arrived="<<s.completed()
                <<" recoveries="<<s.recoveries()<<'\n';
            for(const auto& e:s.entities()) {
                auto anchor=progressAnchors.find(e.id);
                if(anchor==progressAnchors.end() || length(e.center-anchor->second)>=.25) {
                    progressAnchors[e.id]=e.center; lastFleetProgress=s.seconds();
                }
                auto old=previous.find(e.id);
                if(old!=previous.end() && length(e.center-old->second)>50*dt+1e-6) {
                    std::cerr<<"step="<<step<<" id="<<e.id<<" old="<<old->second.x<<','<<old->second.y
                        <<" new="<<e.center.x<<','<<e.center.y<<" speed="<<e.speed<<" next="<<e.next
                        <<" progress="<<e.segmentProgress<<" local="<<e.usingLocalDetour<<" reverse="<<e.reversing<<'\n';
                    throw std::runtime_error("Recovery skipped physical movement");
                }
                previous[e.id]=e.center;
                if(step%12==0) {
                    if(!s.map().fits(e.footprint())) throw std::runtime_error("Body left mask during recovery");
                    for(const auto& other:s.entities()) if(e.id<other.id &&
                        clearance(e.footprint(),other.footprint())+1e-5<std::min(e.preferredDistance,other.preferredDistance))
                        throw std::runtime_error("Recovery violated pairwise clearance");
                }
            }
            if(step*dt>=duration && !s.entities().empty() && s.seconds()-lastFleetProgress>60) {
                bool allSignalWait=true;
                for(const auto& e:s.entities()) allSignalWait=allSignalWait && e.waitingForLight;
                if(!allSignalWait) throw std::runtime_error("Whole fleet remained physically stationary during arc drain");
            }
            if(step*dt>=duration && s.entities().empty()) break;
        }
        std::cout<<"seed="<<seed<<" rate="<<rate<<" admitted="<<admitted<<" completed="<<s.completed()
                 <<" remaining="<<s.entities().size()<<" recoveries="<<s.recoveries()<<" sim="<<s.seconds()
                 <<" wall="<<std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count()<<"s\n";
        if(admitted<3 || s.completed()!=admitted || !s.entities().empty()) {
            for(const auto& e:s.entities()) std::cerr<<e.id<<' '<<vehicleName(e.kind)<<" at "<<e.center.x<<','<<e.center.y
                <<" stationary="<<e.noProgressSeconds<<" light="<<e.waitingForLight<<" maneuver="<<e.waitingForManeuver<<" reverse="<<e.reversing<<'\n';
            throw std::runtime_error("All admitted preset traffic must reach its destination");
        }
    } catch(const std::exception& e) { std::cerr<<e.what()<<'\n'; return 1; }
}


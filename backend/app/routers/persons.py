from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from ..crud import apply_patch, get_or_404
from ..database import get_db
from ..models import Person
from ..schemas import PersonCreate, PersonOut, PersonUpdate

log = logging.getLogger(__name__)
router = APIRouter(prefix="/persons", tags=["persons"])


@router.get("", response_model=list[PersonOut])
def list_persons(db: Session = Depends(get_db)) -> list[Person]:
    return db.query(Person).order_by(Person.name).all()


@router.post("", response_model=PersonOut, status_code=status.HTTP_201_CREATED)
def create_person(body: PersonCreate, db: Session = Depends(get_db)) -> Person:
    person = Person(**body.model_dump())
    db.add(person)
    db.commit()
    db.refresh(person)
    log.info("Created person %d (%s)", person.id, person.name)
    return person


@router.get("/{person_id}", response_model=PersonOut)
def get_person(person_id: int, db: Session = Depends(get_db)) -> Person:
    return get_or_404(db, Person, person_id, "Person not found")


@router.put("/{person_id}", response_model=PersonOut)
def update_person(person_id: int, body: PersonUpdate, db: Session = Depends(get_db)) -> Person:
    person = get_or_404(db, Person, person_id, "Person not found")
    apply_patch(person, body.model_dump(exclude_unset=True))
    db.commit()
    db.refresh(person)
    log.info("Updated person %d (%s)", person.id, person.name)
    return person


@router.delete("/{person_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_person(person_id: int, db: Session = Depends(get_db)) -> None:
    person = get_or_404(db, Person, person_id, "Person not found")
    log.info("Deleted person %d (%s)", person.id, person.name)
    db.delete(person)
    db.commit()

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Person
from ..schemas import PersonCreate, PersonOut, PersonUpdate

router = APIRouter(prefix="/persons", tags=["persons"])


@router.get("", response_model=list[PersonOut])
def list_persons(db: Session = Depends(get_db)):
    return db.query(Person).order_by(Person.name).all()


@router.post("", response_model=PersonOut, status_code=201)
def create_person(body: PersonCreate, db: Session = Depends(get_db)):
    person = Person(**body.model_dump())
    db.add(person)
    db.commit()
    db.refresh(person)
    return person


@router.get("/{person_id}", response_model=PersonOut)
def get_person(person_id: int, db: Session = Depends(get_db)):
    person = db.query(Person).get(person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    return person


@router.put("/{person_id}", response_model=PersonOut)
def update_person(person_id: int, body: PersonUpdate, db: Session = Depends(get_db)):
    person = db.query(Person).get(person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(person, field, value)
    db.commit()
    db.refresh(person)
    return person


@router.delete("/{person_id}", status_code=204)
def delete_person(person_id: int, db: Session = Depends(get_db)):
    person = db.query(Person).get(person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    db.delete(person)
    db.commit()
